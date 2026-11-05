'use strict';
importScripts('core.js');
const STATE_KEY = 'autopilot5_state';
const LOG_KEY = 'autopilot5_logs';
const OLD_STATE_KEY = 'autopilot4_state';
const OLD_LOG_KEY = 'autopilot4_logs';
const MENU = 'autopilot5_open_report';
const ALARM = 'autopilot5_recovery';
const MAX_LOGS = 5000;
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
// A duplicate conversation must have exactly one input owner per Chrome window.
// Owner selection is based on live tabs, not stale in-memory navigation records.
// Fail closed if the tab query is unavailable; recheck after claiming Enter.
async function preferredChatTab(id, session, conversationId) {
  const state=await getState();
  if(!state.enabled || state.session!==session || !state.tabIds.includes(id))return false;
  try {
    const tabs=await chrome.tabs.query({windowId:state.windowId});
    const candidates=tabs.filter(tab=>state.tabIds.includes(tab.id) &&
      !tab.discarded && chatUrl(tab.url) && new URL(tab.url).pathname===conversationId);
    candidates.sort((a,b)=>a.id-b.id);
    return candidates[0]?.id===id;
  }catch{return false;}
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
    ? `ChatGPT Autopilot v5.5 · ${arr.length} conversations · ${sent} sends · ${held} conversations requiring review\nClick to stop; right-click for report`
    : 'ChatGPT Autopilot v5.5 · off · click to start; right-click for report'});
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
async function clearRestoredPrompt(target,id,expected) {
  // Some UIs leave the recalled prompt visible after a failed completion
  // gate. Only clear text when content.js proves it is still exactly our
  // recalled prompt and the same conversation/composer has focus.
  const check=await tabMessage(id,'AP5_CLEANUP_CHECK',{expected}).catch(()=>null);
  if(!check?.ok)return false;
  const mac=check.modifier==='Meta',modifier=mac?4:2;
  const modKey=mac?'Meta':'Control',modCode=mac?'MetaLeft':'ControlLeft',modV=mac?91:17;
  const m={key:modKey,code:modCode,windowsVirtualKeyCode:modV,nativeVirtualKeyCode:modV,modifiers:modifier};
  const a={key:'a',code:'KeyA',windowsVirtualKeyCode:65,nativeVirtualKeyCode:65,modifiers:modifier};
  await dispatch(target,'Input.dispatchKeyEvent',{type:'rawKeyDown',...m});
  try {
    await dispatch(target,'Input.dispatchKeyEvent',{type:'rawKeyDown',...a});
    await dispatch(target,'Input.dispatchKeyEvent',{type:'keyUp',...a});
  }finally{
    await dispatch(target,'Input.dispatchKeyEvent',{type:'keyUp',...m}).catch(()=>{});
  }
  await pressKey(target,'Backspace','Backspace',8);
  const after=await tabMessage(id,'AP5_INSPECT').catch(()=>null);
  return !!after && !after.hasDraft;
}
async function act(id,session,observed) {
  const expected={conversationId:observed.conversationId,assistantSig:observed.assistantSig,
    userCount:observed.userCount,lastUserSig:observed.lastUserSig};
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
    await wait(180);
    check=await tabMessage(id,'AP5_AFTER_UP',{expected});
    if(!check?.ok) {
      // Do not send Enter when ArrowUp opened message editing, did nothing or
      // the assistant started producing again. Skip this tab, keep others running.
      // No blind Escape: ArrowUp may have opened a different ChatGPT editor.
      // The finally block checks if a precisely matched recall can be cleaned.
      return {kind:'skip',reason:check?.reason||'ArrowUp did not recall the prompt'};
    }

    if(!await running(session))return {kind:'skip',reason:'Monitoring stopped before Enter'};
    // Last-moment independent gate: must STILL have a completed assistant
    // response and the exact same restored message focused in the composer.
    check=await tabMessage(id,'AP5_BEFORE_ENTER',{expected});
    if(!check?.ok) return {kind:'skip',reason:check?.reason||'Response completion not confirmed'};
    if(!await running(session))return {kind:'skip',reason:'Monitoring stopped before Enter'};
    // Enter may be delivered even if the service worker dies after this write.
    // On restart, `sending` is treated as uncertain, never blindly resent.
    const claimed=await mark(id,session,(item,wholeState)=>{
      if(item.phase!=='preparing')return false;
      const completionKey=`${observed.conversationId}|${observed.userCount}|${observed.assistantSig}`;
      wholeState.handledGlobally ||= {};
      if(wholeState.handledGlobally[completionKey])return false;
      // Persist a session-scoped claim across tab closure; another copy must not
      // replay a response if Enter may already have been dispatched.
      wholeState.handledGlobally[completionKey]={tabId:id,claimedAt:time()};
      item.handledCompletionKey=completionKey;
      item.phase='sending';item.status='Enter may have been sent; awaiting acknowledgement';
      item.sentAt=time();item.baseline={conversationId:observed.conversationId,
        userCount:observed.userCount,assistantSig:observed.assistantSig,
        sentPromptSig:observed.lastUserSig};
      return true;
    });
    if(claimed!==true) return {kind:'skip',reason:'Session changed before Enter'};
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
      return {kind:'skip',reason:'Final post-persistence check failed; Enter NOT sent'};
    }
    enterBoundary=true;
    await pressKey(target,'Enter','Enter',13,'\r');
    return {kind:'sent'};
  }catch(err){
    return {kind:enterBoundary?'hold':'skip',
      reason:`Tab input failed: ${String(err?.message||err).slice(0,200)}`};
  }finally{
    // We know no Enter was attempted. Do not leave our recalled text in the
    // user's composer after an unrelated safety gate failed. A human-edited
    // field is never cleared; only an exact fingerprint match is eligible.
    if(attached && arrowUpAttempted && !enterBoundary && await running(session)) {
      try {
        const clean=await clearRestoredPrompt(target,id,expected);
        if(!clean)await logEvent('draft_cleanup_skipped',id,
          'Recalled prompt may remain; automatic cleanup not proven safe','warning');
      }catch(err){
        await logEvent('draft_cleanup_failed',id,String(err?.message||err),'warning');
      }
    }
    if(attached)await chrome.debugger.detach(target).catch(()=>{});
  }
}
async function scanOne(id) {
  let s=await getState();
  if(!s.enabled||!s.items[id]) return;
  const session=s.session;
  let tab;
  try {tab=await chrome.tabs.get(id);}catch{tab=null;}
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
  // A duplicate tab never receives input for an already-handled response,
  // including after the original tab has been closed.
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
      if(item.phase==='watching'){
        item.status='Duplicate conversation; another tab is the input owner';
        item.reason='Skipping this copy; it will become eligible if the owner closes';
        item.candidateKey='';item.candidateAt=0;
      }
    });
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
  await logEvent('send_preparing',id,'Click composer → ArrowUp → verify text → Enter', 'info',result.name);
  const attempted=await act(id,session,observed);
  if(!await running(session))return;
  const update=await mark(id,session,item=>{
    if(attempted.kind==='sent') {
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
    const event=attempted.kind==='sent'?'send_enter':attempted.kind==='skip'?'send_skipped':'tab_needs_review';
    await logEvent(event,id,attempted.reason||(attempted.kind==='sent'?'Awaiting continuation message acknowledgement':'Skipped without sending'),
      attempted.kind==='hold'?'warning':'info',update.name);
    await badge();
  }
  // Rescan quickly; further waits are event-driven, never a 10 minute loop.
  if(attempted.kind==='sent') setTimeout(()=>scheduleTab(id),900);
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
  await logEvent('extension_ready',null,'ChatGPT Tab Autopilot v5.5.0');
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
  if(msg.type==='AP5_TOGGLE' && sender.id===chrome.runtime.id && !sender.tab){
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
