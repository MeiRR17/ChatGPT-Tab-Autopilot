'use strict';
importScripts('core.js');
const STATE_KEY = 'autopilot5_state';
const LOG_KEY = 'autopilot5_logs';
const OLD_STATE_KEY = 'autopilot4_state';
const OLD_LOG_KEY = 'autopilot4_logs';
const MENU = 'autopilot5_open_report';
const ALARM = 'autopilot5_recovery';
const MAX_LOGS = 5000;
const SETTINGS_KEY = 'autopilot5_settings';
const DEFAULT_SETTINGS = Object.freeze({rotateEnabled:true,rotateAfter:10,rotateDelayMs:3500});
const clamp = (v,min,max,def) => Number.isInteger(Number(v)) ? Math.min(max,Math.max(min,Number(v))) : def;
async function getSettings(){
  const data=(await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]||{};
  return {rotateEnabled:data.rotateEnabled!==false,
    rotateAfter:clamp(data.rotateAfter,1,100,10),
    rotateDelayMs:clamp(data.rotateDelayMs,2000,15000,3500)};
}

const DEFAULT = () => ({enabled:false, windowId:null, session:'', tabIds:[], items:{},
  discardFlags:{}, handledGlobally:{}, startedAt:0, stoppedAt:0, reason:''});
const locks = new Set(), queued = new Set();
const scriptRetryAt = new Map();
let stateQueue = Promise.resolve(), logQueue = Promise.resolve(), toggleQueue=Promise.resolve();
const time = () => Date.now();
const wait = ms => new Promise(r => setTimeout(r, ms));
const chatUrl = url => {
  try { const u=new URL(url); return ['chatgpt.com','chat.openai.com'].includes(u.hostname) &&
    /^\/(?:g\/[^/]+\/)?c\/[^/]+/.test(u.pathname); } catch { return false; }
};
const tabMessage = (id,type,extra={}) => chrome.tabs.sendMessage(id,{type,...extra},{frameId:0});
// Multiple tabs may display the SAME conversation. Only the lowest-ID monitored,
// live tab is allowed to interact with its composer. Fail closed if tab listing
// is unavailable; this guard is repeated immediately before Enter.
async function preferredChatTab(id, session, conversationId) {
  const state = await getState();
  if (!state.enabled || state.session !== session || !state.tabIds.includes(id)) return false;
  try {
    const tabs = await chrome.tabs.query({windowId:state.windowId});
    const candidates = tabs.filter(tab => state.tabIds.includes(tab.id) &&
      !tab.discarded && chatUrl(tab.url) && new URL(tab.url).pathname === conversationId);
    candidates.sort((a,b)=>a.id-b.id);
    return candidates[0]?.id === id;
  } catch { return false; }
}
async function getState() { return (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || DEFAULT(); }
function mutateState(fn) {
  const current = stateQueue.then(async()=>{
    const s=await getState();
    const before=JSON.stringify(s);
    const out=fn(s);
    if(JSON.stringify(s)!==before) await chrome.storage.local.set({[STATE_KEY]:s});
    return out;
  });
  stateQueue=current.catch(err=>console.error('AP5 state',err));
  return current;
}
function logEvent(event,tabId=null,message='',level='info',title='') {
  const job = logQueue.then(async()=>{
    const prev=(await chrome.storage.local.get(LOG_KEY))[LOG_KEY]||[];
    const row={timestamp:new Date().toISOString(),event:String(event).slice(0,65),
      tabId:Number.isInteger(tabId)?tabId:null, message:String(message).slice(0,450),
      level,title:String(title).slice(0,100)};
    const next=[...prev,row];
    if(next.length>MAX_LOGS) next.splice(0,next.length-MAX_LOGS);
    await chrome.storage.local.set({[LOG_KEY]:next});
  });
  logQueue=job.catch(err=>console.error('AP5 log',err));
  return job;
}
async function badge() {
  const s=await getState(), arr=Object.values(s.items||{});
  const sent=arr.reduce((n,x)=>n+(x.sent||0),0);
  const held=arr.filter(x=>x.phase==='needs_review').length;
  await chrome.action.setBadgeText({text:!s.enabled?'':held?'!':String(sent||'ON')});
  await chrome.action.setBadgeBackgroundColor({color:held?'#b45309':'#15803d'});
  await chrome.action.setTitle({title:s.enabled
    ? `ChatGPT Autopilot v5.8.0 · ${arr.length} conversations · ${sent} sends · ${held} conversations requiring review\nClick to stop; right-click for report`
    : 'ChatGPT Autopilot v5.8.0 · off · click to start; right-click for report'});
}
async function running(session) { const s=await getState(); return s.enabled&&s.session===session; }
async function stop(reason='Stopped by user') {
  const prev=await getState();
  scriptRetryAt.clear();
  await mutateState(s=>{ if (s.enabled) {s.enabled=false; s.stoppedAt=time(); s.reason=reason;} });
  await chrome.alarms.clear(ALARM);
  await Promise.allSettled((prev.tabIds||[]).map(id=>tabMessage(id,'AP5_MONITOR',{enabled:false})));
  await Promise.allSettled(Object.entries(prev.discardFlags||{}).map(([id,flag])=>
    chrome.tabs.update(Number(id),{autoDiscardable:!!flag})));
  await logEvent('monitor_stopped',null,reason);
  await badge();
}
async function addTab(tab) {
  let item;
  const added=await mutateState(s=>{
    if(!s.enabled||!chatUrl(tab.url)||tab.windowId!==s.windowId||!Number.isInteger(tab.id)||s.items[tab.id]) return false;
    item=AutopilotCore.newItem(tab.title||`Tab ${tab.index+1}`);
    s.items[tab.id]=item;
    s.tabIds.push(tab.id);
    s.discardFlags[tab.id]=tab.autoDiscardable;
    return true;
  });
  if(added){
    await logEvent('tab_added',tab.id,'Conversation added to monitoring','info',item.name);
    await chrome.tabs.update(tab.id,{autoDiscardable:false}).catch(()=>{});
    await tabMessage(tab.id,'AP5_MONITOR',{enabled:true}).catch(()=>{});
  }
  return added;
}
async function start(tab) {
  const all=await chrome.tabs.query({windowId:tab.windowId});
  const chosen=all.filter(t=>Number.isInteger(t.id)&&chatUrl(t.url)).sort((a,b)=>a.index-b.index);
  if(!chosen.length){
    await logEvent('start_rejected',null,'No ChatGPT conversations found in this window','warning');
    return;
  }
  const s=DEFAULT(); s.enabled=true; s.windowId=tab.windowId; s.session=crypto.randomUUID(); s.startedAt=time();
  await mutateState(current=>Object.assign(current,s));
  await logEvent('monitor_started',null,`Found ${chosen.length} conversations; continuous independent monitoring`);
  await Promise.allSettled(chosen.map(addTab));
  await chrome.alarms.create(ALARM,{periodInMinutes:0.5});
  await badge();
  await scanAll();
}
async function mark(id,session,mutator) {
  return mutateState(s=>{
    if(!s.enabled||s.session!==session||!s.items[id]) return null;
    return mutator(s.items[id],s);
  });
}
const dispatch = (target,method,params) => chrome.debugger.sendCommand(target,method,params);
async function mouseClick(target,x,y) {
  await dispatch(target,'Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
  await dispatch(target,'Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
  await dispatch(target,'Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
}
async function pressKey(target,key,code,virtualKey,text=null) {
  const base={key,code,windowsVirtualKeyCode:virtualKey,nativeVirtualKeyCode:virtualKey};
  await dispatch(target,'Input.dispatchKeyEvent',{type:'keyDown',...base,
    ...(text===null?{}:{text,unmodifiedText:text})});
  await dispatch(target,'Input.dispatchKeyEvent',{type:'keyUp',...base});
}
// Never select-all, Backspace, Escape, or programmatically erase a recalled
// user prompt. An uncertain ArrowUp leaves the field untouched and places
// only this conversation in review; all other chats continue monitoring.
const AFTER_UP_SETTLE_ATTEMPTS = 12;
const AFTER_UP_SETTLE_MS = 175;
async function awaitRestoredPrompt(id,expected) {
  let result=null;
  for(let attempt=0;attempt<AFTER_UP_SETTLE_ATTEMPTS;attempt++) {
    result=await tabMessage(id,'AP5_AFTER_UP',{expected}).catch(()=>null);
    if(result?.ok)return result;
    // React may enable the Send button shortly AFTER the native ArrowUp event.
    // Do not press ArrowUp a second time while waiting.
    if(attempt<AFTER_UP_SETTLE_ATTEMPTS-1)await wait(AFTER_UP_SETTLE_MS);
  }
  return result||{ok:false,reason:'ArrowUp result could not be inspected'};
}

async function act(id,session,observed) {
  const expected={conversationId:observed.conversationId,assistantSig:observed.assistantSig,
    userCount:observed.userCount,lastUserSig:observed.lastUserSig,
    lastUserId:observed.lastUserId};
  let prepared;
  try { prepared=await tabMessage(id,'AP5_PREPARE',{expected}); }
  catch { return {kind:'skip',reason:'Page reloaded; skipping'}; }
  if(!prepared?.ok) return {kind:'skip',reason:prepared?.reason||'Conversation changed'};
  if(!await preferredChatTab(id,session,expected.conversationId))
    return {kind:'skip',reason:'Duplicate conversation or tab ownership changed'};
  const target={tabId:id};let attached=false,enterBoundary=false,arrowUpAttempted=false;
  try {
    await chrome.debugger.attach(target,'1.3');attached=true;
    if(!await running(session))return {kind:'skip',reason:'Monitoring stopped'};
    // Navigation can occur between PREPARE and debugger attachment.
    const currentTab=await chrome.tabs.get(id).catch(()=>null);
    if(!currentTab || !chatUrl(currentTab.url) ||
       new URL(currentTab.url).pathname!==expected.conversationId)
      return {kind:'skip',reason:'Tab navigated before mouse click'};
    const currentPage=await tabMessage(id,'AP5_PREPARE',{expected}).catch(()=>null);
    if(!currentPage?.ok)
      return {kind:'skip',reason:'Page changed before mouse click'};
    if(!await preferredChatTab(id,session,expected.conversationId))
      return {kind:'skip',reason:'Another tab now owns this conversation'};
    await mouseClick(target,currentPage.x,currentPage.y);
    await wait(100);
    let check=await tabMessage(id,'AP5_AFTER_CLICK',{expected});
    if(!check?.ok)return {kind:'skip',reason:check?.reason||'Click did not focus the composer'};
    if(!await running(session))return {kind:'skip',reason:'Monitoring stopped'};
    arrowUpAttempted=true;
    await pressKey(target,'ArrowUp','ArrowUp',38);
    check=await awaitRestoredPrompt(id,expected);
    if(!check?.ok) {
      // Do not send Enter when ArrowUp opened message editing, did nothing or
      // the assistant started producing again. Skip this tab, keep others running.
      // No blind Escape: ArrowUp may have opened a different ChatGPT editor.
      // IMPORTANT: Never auto-delete user-visible text, and never retry
      // ArrowUp indefinitely on the same chat. Hold only this tab for review.
      return {kind:'hold',reason:'ArrowUp not verified; preserved composer; no Enter: '+
        (check?.reason||'Unknown composer state')};
    }

    if(!await running(session))return {kind:'hold',reason:'Stopped after ArrowUp; preserving composer'};
    // Last-moment independent gate: must STILL have a completed assistant
    // response and the exact same restored message focused in the composer.
    check=await tabMessage(id,'AP5_BEFORE_ENTER',{expected});
    if(!check?.ok) return {kind:'hold',reason:'Cannot safely press Enter; preserving composer: '+(check?.reason||'Response completion not confirmed')};
    if(!await running(session))return {kind:'hold',reason:'Stopped after ArrowUp; preserving composer'};
    // Enter may be delivered even if the service worker dies after this write.
    // On restart, `sending` is treated as uncertain, never blindly resent.
    const claimed=await mark(id,session,(item,wholeState)=>{
      if(item.phase!=='preparing')return false;
      const completionKey=`${observed.conversationId}|${observed.userCount}|${observed.assistantSig}`;
      wholeState.handledGlobally ||= {};
      if(wholeState.handledGlobally[completionKey])return false;
      // A durable claim survives tab closure. Other copies of the same chat
      // must not replay this response even if its original tab disappears.
      wholeState.handledGlobally[completionKey]={tabId:id,claimedAt:time()};
      item.handledCompletionKey=completionKey;
      item.phase='sending';item.status='Enter may have been sent; awaiting acknowledgement';
      item.sentAt=time();item.baseline={conversationId:observed.conversationId,
        userCount:observed.userCount,lastUserId:observed.lastUserId,
        assistantSig:observed.assistantSig,
        sentPromptSig:observed.lastUserSig};
      return true;
    });
    if(claimed!==true) return {kind:'hold',reason:'Session/claim changed after ArrowUp; preserving composer'};
    // Persisting the claim can take time. Revalidate once more AFTER the
    // storage write: a Stop button, tool approval or navigation may appear
    // during that gap. A failed check is safe to roll back: no Enter happened.
    const finalGate=await tabMessage(id,'AP5_BEFORE_ENTER',{expected}).catch(()=>null);
    const tabNow=await chrome.tabs.get(id).catch(()=>null);
    if(!finalGate?.ok || !tabNow || !chatUrl(tabNow.url) ||
       new URL(tabNow.url).pathname!==expected.conversationId ||
       !await preferredChatTab(id,session,expected.conversationId) || !await running(session)) {
      await mark(id,session,(item,wholeState)=>{
        const key=`${observed.conversationId}|${observed.userCount}|${observed.assistantSig}`;
        if(item.phase==='sending' && item.handledCompletionKey===key){
          if(wholeState.handledGlobally?.[key]?.tabId===id)
            delete wholeState.handledGlobally[key];
          item.phase='preparing'; // scanOne will apply the safe skip backoff
          item.handledCompletionKey='';
          item.baseline=null;item.sentAt=0;
        }
      });
      return {kind:'hold',reason:'Final post-persistence check failed; Enter NOT sent; composer preserved'};
    }
    enterBoundary=true;
    await pressKey(target,'Enter','Enter',13,'\r');
    return {kind:'sent'};
  }catch(err){
    return {kind:(enterBoundary||arrowUpAttempted)?'hold':'skip',
      reason:`Tab input failed${arrowUpAttempted?'; composer preserved':''}: ${String(err?.message||err).slice(0,200)}`};
  }finally{
    // Nothing in the normal path deletes or alters a recalled prompt.
    // If validation failed, the affected chat remains visible for inspection.
    if(attached)await chrome.debugger.detach(target).catch(()=>{});
  }
}
// Rollover is deliberately confined to the same physical Chrome tab.
// The old prompt is recovered by ArrowUp, verified, and cleared BEFORE clicking
// New Chat. A bounded excerpt of the last assistant response is transferred
// in memory only: a new conversation does not inherit old history.
function handoffText(lastPrompt,excerpt){
  const prior=String(excerpt||'').slice(-7000);
  const task=String(lastPrompt||'').slice(0,500);
  if(!prior.trim() || !task.trim())return '';
  return `This is a NEW ChatGPT conversation continuing previous project work. The prior conversation is not available here. Use only the following excerpt, do not invent missing details.\n\nPrevious assistant response (excerpt):\n${prior}\n\nPrevious user continuation instruction:\n${task}\n\nContinue that work from the available evidence. State any essential missing context clearly.`;
}
async function rotateChat(id,session,observed,settings){
  const expected={conversationId:observed.conversationId,assistantSig:observed.assistantSig,
    userCount:observed.userCount,lastUserSig:observed.lastUserSig,lastUserId:observed.lastUserId};
  const first=await tabMessage(id,'AP5_PREPARE',{expected}).catch(()=>null);
  if(!first?.ok)return {kind:'skip',reason:first?.reason||'Conversation is not yet ready for rotation'};
  if(!await preferredChatTab(id,session,expected.conversationId))
    return {kind:'skip',reason:'Duplicate conversation has another owner'};
  const target={tabId:id};let attached=false,clickedNew=false,enterBoundary=false,arrowAttempt=false;
  try{
    await chrome.debugger.attach(target,'1.3');attached=true;
    if(!await running(session))return {kind:'skip',reason:'Monitoring stopped before rotation'};
    const before=await tabMessage(id,'AP5_PREPARE',{expected}).catch(()=>null);
    if(!before?.ok)return {kind:'skip',reason:'Page changed before rotation'};
    await mouseClick(target,before.x,before.y);
    const focused=await tabMessage(id,'AP5_AFTER_CLICK',{expected}).catch(()=>null);
    if(!focused?.ok)return {kind:'skip',reason:'Composer not focused; skipping rollover'};
    arrowAttempt=true;await pressKey(target,'ArrowUp','ArrowUp',38);
    const checked=await awaitRestoredPrompt(id,expected);
    if(!checked?.ok)return {kind:'hold',reason:'Rollover ArrowUp not verified; draft preserved: '+(checked?.reason||'Unknown state')};
    const captured=await tabMessage(id,'AP5_ROLLOVER_CAPTURE',{expected}).catch(()=>null);
    if(!captured?.ok)return {kind:'hold',reason:'Could not capture verified prompt; draft preserved'};
    const seed=handoffText(captured.prompt,captured.assistantExcerpt);
    if(!seed)return {kind:'hold',reason:'Missing context; draft preserved; no new chat opened'};
    // Never erase the recalled text in the old conversation. New Chat may
    // open a blank draft; if it carries the old draft forward, NEW_CHAT_PREPARE
    // rejects the handoff without deleting or overwriting anything.
    const newChat=await tabMessage(id,'AP5_FIND_NEW_CHAT').catch(()=>null);
    if(!newChat?.ok)return {kind:'hold',reason:'Rollover blocked; old draft preserved: '+(newChat?.reason||'New Chat control not found')};
    // Durable pre-navigation claim: if Chrome crashes mid-transfer, the
    // extension never replays the same assistant completion blindly.
    const key=`${observed.conversationId}|${observed.userCount}|${observed.assistantSig}`;
    const claimed=await mark(id,session,(item,s)=>{
      if(item.phase!=='preparing'||s.handledGlobally?.[key])return false;
      s.handledGlobally ||= {};s.handledGlobally[key]={tabId:id,claimedAt:time(),rollover:true};
      item.phase='rotating';item.status='Opening new ChatGPT conversation';
      item.rotationOldId=expected.conversationId;
      item.rotationStartedAt=time();item.handledCompletionKey=key;
      return true;
    });
    if(!claimed)return {kind:'hold',reason:'Rotation claim lost after ArrowUp; composer preserved'};
    // Do not click a control that became invalid between DOM lookup and use.
    if(!await running(session))return {kind:'hold',reason:'Monitoring stopped near new-chat navigation'};
    const current=await tabMessage(id,'AP5_FIND_NEW_CHAT').catch(()=>null);
    if(!current?.ok)return {kind:'hold',reason:'New Chat disappeared after rollover claim'};
    clickedNew=true;
    await mouseClick(target,current.x,current.y);
    let ready=null;
    for(let i=0;i<30;i++){
      if(!await running(session))return {kind:'hold',reason:'Monitoring stopped during new chat navigation'};
      await wait(350);
      try {ready=await tabMessage(id,'AP5_NEW_CHAT_PREPARE');}
      catch {
        // A full navigation discards the content script; only reinject into
        // the verified ChatGPT origin, not into unrelated websites.
        const tab=await chrome.tabs.get(id).catch(()=>null);
        if(tab && /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//.test(tab.url||''))
          await chrome.scripting.executeScript({target:{tabId:id},files:['content.js']}).catch(()=>{});
      }
      if(ready?.ok)break;
    }
    if(!ready?.ok)return {kind:'hold',reason:'New Chat did not load; no Enter attempted'};
    await mouseClick(target,ready.x,ready.y);
    const newFocus=await tabMessage(id,'AP5_NEW_CHAT_FOCUSED').catch(()=>null);
    if(!newFocus?.ok)return {kind:'hold',reason:'New chat composer not focused'};
    // CDP text input belongs to the target tab; it does not touch the OS
    // clipboard or keyboard and works even when Chrome is in the background.
    await dispatch(target,'Input.insertText',{text:seed});
    await wait(settings.rotateDelayMs);
    const verified=await tabMessage(id,'AP5_NEW_CHAT_VERIFY',{expectedText:seed}).catch(()=>null);
    if(!verified?.ok)return {kind:'hold',reason:verified?.reason||'New chat text validation failed; Enter not sent'};
    if(!await running(session))return {kind:'hold',reason:'Stopped before new-chat Enter'};
    // Persist intent before Enter; uncertain delivery is never retried blindly.
    const marked=await mark(id,session,item=>{
      if(item.phase!=='rotating')return false;
      item.phase='rotating_enter';item.status='New-chat Enter may be dispatched';return true;
    });
    if(!marked)return {kind:'hold',reason:'Rollover session changed before Enter'};
    const final=await tabMessage(id,'AP5_NEW_CHAT_VERIFY',{expectedText:seed}).catch(()=>null);
    if(!final?.ok || !await running(session))
      return {kind:'hold',reason:'New Chat final safety gate failed; Enter NOT attempted'};
    enterBoundary=true;
    await pressKey(target,'Enter','Enter',13,'\r');
    return {kind:'rotated',seedSig:verified.seedSig || '',bootstrapLanguage:/[\u0590-\u05ff]/u.test(captured.prompt)?'he':'en',reason:'Entered new chat with bounded context excerpt'};
  }catch(e){
    return {kind:(arrowAttempt||clickedNew||enterBoundary)?'hold':'skip',reason:'New chat rollover failed; composer preserved: '+String(e?.message||e).slice(0,180)};
  }finally{
    if(attached)await chrome.debugger.detach(target).catch(()=>{});
  }
}
async function inspectNewChatAck(id,session,item,tab){
  // During new-chat creation the URL can temporarily be '/' rather than '/c/id'.
  if(!chatUrl(tab?.url)) {
    if(time()-(item.rotationStartedAt||0)>120000)
      await mark(id,session,x=>{x.phase='needs_review';x.status='New-chat delivery not confirmed';
        x.reason='Check whether the initial handoff message was sent';});
    return;
  }
  const obs=await tabMessage(id,'AP5_INSPECT').catch(()=>null);
  if(!obs?.loaded)return;
  const valid=obs.lastUserSemanticSig===item.rotationSeedSig && obs.userCount>=1 &&
    obs.conversationId!==item.rotationOldId;
  if(valid){
    await mark(id,session,x=>{
      if(x.phase!=='await_new_chat')return;
      x.conversationId=obs.conversationId;
      x.baseline={conversationId:obs.conversationId,userCount:obs.userCount-1,
        assistantSig:'',sentPromptSig:obs.lastUserSig,lastUserId:''};
      x.phase='await_reply';x.status='New chat acknowledged; awaiting its reply';
      x.rotationOldId='';x.rotationSeedSig='';x.bootstrapPending=true;
    });
    await logEvent('new_chat_acknowledged',id,'New chat initial request acknowledged');
    return;
  }
  if(time()-(item.rotationStartedAt||0)>120000)
    await mark(id,session,x=>{x.phase='needs_review';x.status='New-chat handoff uncertain';
      x.reason='Do not resend automatically. Check the new conversation';});
}
// The initial handoff is a long user message. After it receives a completed
// assistant reply, send ONE short continuation with physical-equivalent input
// to bootstrap ArrowUp for subsequent turns; never replay the long handoff.
async function bootstrapChat(id,session,observed,language){
  const prompt=language==='he'?'תמשיך את הפיתוח':'Continue the development.';
  const expected={conversationId:observed.conversationId,assistantSig:observed.assistantSig,
    userCount:observed.userCount,lastUserSig:observed.lastUserSig,lastUserId:observed.lastUserId};
  const first=await tabMessage(id,'AP5_BOOTSTRAP_PREPARE',{expected}).catch(()=>null);
  if(!first?.ok)return {kind:'skip',reason:'Initial new-chat reply has not fully completed'};
  if(!await preferredChatTab(id,session,expected.conversationId))return {kind:'skip',reason:'Duplicate new-chat owner'};
  const target={tabId:id};let attached=false,inserted=false,enterBoundary=false;
  try{
    await chrome.debugger.attach(target,'1.3');attached=true;
    if(!await running(session))return {kind:'skip',reason:'Monitoring stopped before bootstrap'};
    const check=await tabMessage(id,'AP5_BOOTSTRAP_PREPARE',{expected}).catch(()=>null);
    if(!check?.ok)return {kind:'skip',reason:'New-chat reply changed before bootstrap'};
    await mouseClick(target,check.x,check.y);
    const focus=await tabMessage(id,'AP5_BOOTSTRAP_FOCUSED',{expected}).catch(()=>null);
    if(!focus?.ok)return {kind:'skip',reason:'New-chat bootstrap composer not focused'};
    await dispatch(target,'Input.insertText',{text:prompt});inserted=true;
    const validated=await tabMessage(id,'AP5_BOOTSTRAP_VERIFY',{expected,prompt}).catch(()=>null);
    if(!validated?.ok)return {kind:'hold',reason:'Bootstrap input could not be verified; Enter not sent'};
    if(!await running(session))return {kind:'hold',reason:'Stopped after bootstrap text insertion'};
    const key=`${observed.conversationId}|${observed.userCount}|${observed.assistantSig}`;
    const claimed=await mark(id,session,(item,state)=>{
      if(item.phase!=='preparing'||!item.bootstrapPending||state.handledGlobally?.[key])return false;
      state.handledGlobally ||= {};state.handledGlobally[key]={tabId:id,claimedAt:time(),bootstrap:true};
      item.phase='sending';item.status='Bootstrap Enter may have been sent';
      item.handledCompletionKey=key;item.sentAt=time();
      item.baseline={conversationId:observed.conversationId,userCount:observed.userCount,
        lastUserId:observed.lastUserId,assistantSig:observed.assistantSig,
        sentPromptSig:validated.promptSig};
      return true;
    });
    if(!claimed)return {kind:'hold',reason:'Bootstrap pre-Enter claim rejected'};
    const again=await tabMessage(id,'AP5_BOOTSTRAP_VERIFY',{expected,prompt}).catch(()=>null);
    if(!again?.ok || !await preferredChatTab(id,session,expected.conversationId) || !await running(session))
      return {kind:'hold',reason:'Bootstrap final safety gate failed; Enter not attempted'};
    enterBoundary=true;await pressKey(target,'Enter','Enter',13,'\r');
    return {kind:'bootstrapped',reason:'New chat continuation seeded; future turns use ArrowUp'};
  }catch(err){return {kind:(inserted||enterBoundary)?'hold':'skip',reason:String(err?.message||err).slice(0,180)};}
  finally {if(attached)await chrome.debugger.detach(target).catch(()=>{});}
}
async function scanOne(id) {
  let s=await getState();
  if(!s.enabled||!s.items[id]) return;
  const session=s.session;
  let tab;
  try {tab=await chrome.tabs.get(id);}catch{tab=null;}
  if(s.items[id].phase==='await_new_chat' && tab && tab.windowId===s.windowId){
    await inspectNewChatAck(id,session,s.items[id],tab);return;
  }
  if(['rotating','rotating_enter'].includes(s.items[id].phase)){
    await mark(id,session,item=>{item.phase='needs_review';
      item.status='Rollover interrupted; check this conversation';
      item.reason='Do not retry a partially completed new-chat transition automatically';});
    return;
  }
  if(!tab||!chatUrl(tab.url)||tab.windowId!==s.windowId){
    // Navigating away is an ordinary skip, NOT a failure of every monitored
    // conversation. Preserve uncertain delivery only if an Enter might have
    // been sent in this tab. Returning to a chat can resume watching.
    await mark(id,session,item=>{
      if(['sending','await_ack'].includes(item.phase)) {
        item.phase='needs_review';item.status='Conversation unavailable near an unconfirmed Enter';
        item.reason='Open the original conversation to confirm delivery';
      } else if(item.phase==='await_reply') {
        // The user's continuation was already acknowledged. Navigation must not
        // turn a known delivery into a false uncertain-delivery incident.
        item.status='Awaiting reply; original chat temporarily unavailable';
        item.reason='Return to the same conversation to resume confirmation';
      } else if(item.phase==='needs_review') {
        // Preserve the original reason, not a new generic navigation warning.
        item.status='Only this conversation requires review';
      } else {
        item.phase='watching';item.status='Outside a supported conversation; skipping';
        item.reason='Tab is closed or navigating; will retry when available';
        item.candidateKey='';item.candidateAt=0;
      }
    });
    return;
  }
  if(tab.discarded) {
    await mark(id,session,item=>{ if(item.phase==='watching') item.status='Chrome discarded this tab; skipping'; });
    return;
  }
  let observed;
  try {observed=await tabMessage(id,'AP5_INSPECT');}
  catch{observed=null;}
  if(!observed && (scriptRetryAt.get(id)||0)<time()) {
    // Content scripts may be lost after sleep, crash or navigation. Reinject
    // only into a confirmed supported chat, with a per-tab retry throttle.
    scriptRetryAt.set(id,time()+10000);
    try {
      await chrome.scripting.executeScript({target:{tabId:id},files:['content.js']});
      if(await running(session)) {
        await tabMessage(id,'AP5_MONITOR',{enabled:true});
        setTimeout(()=>scheduleTab(id),1200);
      }
    } catch { /* Page may still be loading; recovery alarm will retry. */ }
  }
  if(!await running(session)) return;
  // A duplicated ChatGPT conversation must never receive two independent
  // continuation attempts. The secondary tab stays monitored and retryable.
  if(observed?.conversationId && s.items[id]?.phase==='watching') {
    const fresh=await getState();
    const key=`${observed.conversationId}|${observed.userCount}|${observed.assistantSig}`;
    if(fresh.handledGlobally?.[key]) {
      await mark(id,session,item=>{
        if(item.phase==='watching'){
          item.status='This completed response was already handled in this session';
          item.reason='Skipping duplicate continuation, including after closing the original tab';
          item.candidateKey='';item.candidateAt=0;
        }
      });
      return;
    }
  }
  if(observed?.conversationId && s.items[id]?.phase==='watching' &&
     !await preferredChatTab(id,session,observed.conversationId)) {
    await mark(id,session,item=>{
      if(item.phase==='watching') {
        item.status='Duplicate conversation; another tab is the input owner';
        item.reason='Skipping this copy; it will become eligible if the owner closes';
        item.candidateKey='';item.candidateAt=0;
      }
    });
    return;
  }
  // After a new-chat handoff, the initial message is long and cannot safely
  // be recalled forever with ArrowUp. Bootstrap one short continuation once
  // that initial reply is positively complete, then resume ordinary checks.
  if(s.items[id]?.phase==='watching' && s.items[id]?.bootstrapPending){
    if(!observed?.loaded || observed.busy || !observed.stable || !observed.completed ||
       !observed.hasComposer || observed.hasDraft || observed.requiresAction || observed.lastRole!=='assistant'){
      await mark(id,session,item=>{item.status='Waiting for initial new-chat reply; skipping';});return;
    }
    const created=await mark(id,session,item=>{
      if(item.phase!=='watching'||!item.bootstrapPending)return false;
      item.phase='preparing';item.status='Preparing short follow-up for new-chat ArrowUp';return true;
    });
    if(!created)return;
    const attempted=await bootstrapChat(id,session,observed,s.items[id].bootstrapLanguage);
    if(!await running(session))return;
    await mark(id,session,item=>{
      if(attempted.kind==='bootstrapped'){
        item.phase='await_ack';item.sent++;item.bootstrapPending=false;
        item.lastActionAt=time();item.status='Short continuation sent; awaiting acknowledgement';
      }else if(attempted.kind==='skip'){
        item.phase='watching';item.retryAfter=time()+3000;
        item.status='Bootstrap skipped; retrying safely';item.reason=attempted.reason;
      }else{
        item.phase='needs_review';item.status='New-chat bootstrap requires review';item.reason=attempted.reason;
      }
    });
    await logEvent(attempted.kind==='bootstrapped'?'bootstrap_sent':'bootstrap_skipped_or_held',
      id,attempted.reason,attempted.kind==='hold'?'warning':'info');
    await badge();
    if(attempted.kind==='bootstrapped')setTimeout(()=>scheduleTab(id),900);
    return;
  }
  const result=await mark(id,session,item=>{
    const decision=AutopilotCore.decide(item,observed,time());
    Object.assign(item,decision.item);
    return {send:decision.send,event:decision.event,level:decision.level,
      status:item.status,reason:item.reason,name:item.name,phase:item.phase};
  });
  if(!result) return;
  if(result.event) await logEvent(result.event,id,result.reason||result.status,result.level,result.name);
  if(!result.send) {
    if(result.event) await badge();
    if(result.event==='reply_completed' || result.event==='completion_candidate')
      setTimeout(()=>scheduleTab(id),2000);
    return;
  }
  // Crash-safe transition, scoped to this tab only. Busy tabs keep scanning elsewhere.
  const created=await mark(id,session,(item,wholeState)=>{
    if(item.phase!=='watching' || item.handledCompletionKey===
      `${observed.conversationId}|${observed.userCount}|${observed.assistantSig}` ||
      wholeState.handledGlobally?.[`${observed.conversationId}|${observed.userCount}|${observed.assistantSig}`]) return false;
    item.phase='preparing';item.status='Clicking Ask ChatGPT, then ArrowUp';item.lastUpdatedAt=time();
    return true;
  });
  if(!created) return;
  const settings=await getSettings();
  const rollover=settings.rotateEnabled &&
    (s.items[id].sent-(s.items[id].rotationAtSent||0))>=settings.rotateAfter;
  await logEvent(rollover?'rollover_preparing':'send_preparing',id,
    rollover?'Click composer → ArrowUp → New Chat → context handoff → Enter':
      'Click composer → ArrowUp → verify text → Enter','info',result.name);
  const attempted=rollover?await rotateChat(id,session,observed,settings):await act(id,session,observed);
  if(!await running(session))return;
  const update=await mark(id,session,item=>{
    if(attempted.kind==='rotated'){
      item.phase='await_new_chat';item.status='New-chat Enter dispatched; awaiting URL and message';
      item.rotationSeedSig=attempted.seedSig;item.bootstrapLanguage=attempted.bootstrapLanguage||'en';item.sent++;
      item.rotationAtSent=item.sent;item.rotationCount=(item.rotationCount||0)+1;
      item.lastActionAt=time();item.sentAt=time();item.conversationId='';item.reason='';
    }else if(attempted.kind==='sent') {
      item.phase='await_ack';item.status='Enter dispatched; awaiting acknowledgement';
      item.sent++;item.lastActionAt=time();item.sentAt ||= time();item.reason='';
    } else if(attempted.kind==='skip') {
      item.phase='watching';item.status='Skipped a tab that was not ready';item.reason=attempted.reason;
      item.retryAfter=time()+2500;
    } else {
      item.phase='needs_review';item.status='Only this conversation requires review';item.reason=attempted.reason;
    }
    item.lastUpdatedAt=time();return {name:item.name};
  });
  if(update){
    const event=attempted.kind==='rotated'?'new_chat_enter':attempted.kind==='sent'?'send_enter':attempted.kind==='skip'?'send_skipped':'tab_needs_review';
    await logEvent(event,id,attempted.reason||(attempted.kind==='sent'?'Awaiting continuation message acknowledgement':'Skipped without sending'),
      attempted.kind==='hold'?'warning':'info',update.name);
    await badge();
  }
  // Rescan quickly; further waits are event-driven, never a 10 minute loop.
  if(['sent','rotated'].includes(attempted.kind)) setTimeout(()=>scheduleTab(id),900);
}
async function scheduleTab(id) {
  if(locks.has(id)){queued.add(id);return;}
  locks.add(id);
  try {
    do {queued.delete(id);await scanOne(id);} while(queued.has(id));
  }catch(err){
    await logEvent('scan_failed',id,String(err?.message||err),'warning').catch(()=>{});
  }finally{locks.delete(id);}
}
async function scanAll() {
  const s=await getState();
  if(s.enabled) await Promise.allSettled(s.tabIds.map(scheduleTab));
}
async function migrate() {
  const data=await chrome.storage.local.get([OLD_STATE_KEY,OLD_LOG_KEY,LOG_KEY,'autopilot5_migrated','autopilot3_logs','autopilot3_state']);
  if(data.autopilot5_migrated)return;
  const oldLogs=Array.isArray(data[OLD_LOG_KEY])?data[OLD_LOG_KEY]:(Array.isArray(data.autopilot3_logs)?data.autopilot3_logs:[]);
  const prevLogs=Array.isArray(data[LOG_KEY])?data[LOG_KEY]:[];
  await chrome.storage.local.set({
    autopilot5_migrated:true,
    autopilot5_previous_snapshot:data[OLD_STATE_KEY]||data.autopilot3_state||null,
    [LOG_KEY]:[...oldLogs,...prevLogs].slice(-MAX_LOGS)
  });
  await logEvent('migration_v4',null,`Imported ${oldLogs.length} legacy log entries and saved previous state snapshot`);
}
async function init() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({id:MENU,title:'Activity report and logs',contexts:['action']});
  await migrate();
  // Normal extension upgrade must not globally stop ongoing monitoring.
  // Pending input is recovered by the state machine; no Enter replay.
  const current=await getState();
  await badge();
  if(current.enabled) {
    await chrome.alarms.create(ALARM,{periodInMinutes:0.5});
    for(const id of (current.tabIds||[])) {
      try { await chrome.scripting.executeScript({target:{tabId:id},files:['content.js']}); } catch {}
      await tabMessage(id,'AP5_MONITOR',{enabled:true}).catch(()=>{});
    }
    scanAll();
  }
  await logEvent('extension_ready',null,'ChatGPT Tab Autopilot v5.8.0');
}
// Serialize user toggles to avoid two rapid clicks starting overlapping runs.
function toggle(tab) {
  const task=toggleQueue.then(async()=>{
    const s=await getState();
    if(s.enabled)await stop();else if(tab)await start(tab);
  });
  toggleQueue=task.catch(err=>logEvent('toggle_error',null,String(err?.message||err),'error'));
  return task;
}
chrome.action.onClicked.addListener(tab=>{toggle(tab).catch(()=>{});});
chrome.contextMenus.onClicked.addListener(info=>{
  if(info.menuItemId===MENU)chrome.runtime.openOptionsPage();
});
// Extension options/report pages are real Chrome *tabs*: sender.tab is
// populated. Reject any external page, content script or different extension.
function isTrustedReportSender(sender){
  if(sender?.id!==chrome.runtime.id)return false;
  try {
    const expected=new URL(chrome.runtime.getURL('report.html'));
    const actual=new URL(sender.url||'');
    return actual.origin===expected.origin && actual.pathname===expected.pathname;
  }catch{return false;}
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  if(!msg?.type)return;
  if(msg.type==='AP5_HELLO' && Number.isInteger(sender.tab?.id)) {
    getState().then(s=>respond({monitored:s.enabled&&s.tabIds.includes(sender.tab.id)}))
      .catch(()=>respond({monitored:false}));
    return true;
  }
  if(['AP5_WAKE','AP5_TICK'].includes(msg.type)&&Number.isInteger(sender.tab?.id)) {
    scheduleTab(sender.tab.id);return;
  }
  if(msg.type==='AP5_SETTINGS' && isTrustedReportSender(sender)){
    (async()=>{
      const settings={rotateEnabled:msg.settings?.rotateEnabled!==false,
        rotateAfter:clamp(msg.settings?.rotateAfter,1,100,10),
        rotateDelayMs:clamp(msg.settings?.rotateDelayMs,2000,15000,3500)};
      await chrome.storage.local.set({[SETTINGS_KEY]:settings});respond({ok:true,settings});
    })().catch(err=>respond({ok:false,error:String(err)}));return true;
  }
  if(msg.type==='AP5_TOGGLE' && isTrustedReportSender(sender)){
    (async()=>{
      const tabs=await chrome.tabs.query({active:true,currentWindow:true});
      await toggle(tabs[0]);respond({ok:true});
    })().catch(e=>respond({ok:false,error:String(e)}));
    return true;
  }
});
chrome.alarms.onAlarm.addListener(a=>{if(a.name===ALARM)scanAll();});
chrome.tabs.onRemoved.addListener(id=>{(async()=>{
  scriptRetryAt.delete(id);
  let removed=false,name='';
  await mutateState(s=>{if(!s.enabled||!s.items[id])return;
    removed=true;name=s.items[id].name;delete s.items[id];
    s.tabIds=s.tabIds.filter(x=>x!==id);delete s.discardFlags[id];});
  if(removed){await logEvent('tab_removed',id,'Tab closed','info',name);await badge();}
})().catch(()=>{});});
chrome.tabs.onUpdated.addListener((id,change,tab)=>{
  if(!change.url&&change.status!=='complete')return;
  (async()=>{
    const s=await getState();
    if(!s.enabled||tab.windowId!==s.windowId)return;
    if(chatUrl(tab.url)){
      const added=await addTab(tab);
      if(!added)await tabMessage(id,'AP5_MONITOR',{enabled:true}).catch(()=>{});
      scheduleTab(id);
    }
  })().catch(()=>{});
});
chrome.runtime.onInstalled.addListener(()=>{init().catch(err=>console.error('AP5 init',err));});
chrome.runtime.onStartup.addListener(()=>{(async()=>{
  const s=await getState();if(s.enabled)await stop('Chrome restarted; monitoring paused to prevent duplicate sends');
  else await badge();
})().catch(()=>{});});
