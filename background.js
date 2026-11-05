'use strict';
importScripts('core.js');
const KEY='autopilot_v51';
let state={running:false,windowId:null,tabs:{},events:[]};
let busyTabs=new Set(), queued=new Set(), timer=null;
async function persist(){await chrome.storage.local.set({[KEY]:state});}
async function restore(){const v=await chrome.storage.local.get(KEY);if(v[KEY])state=v[KEY];}
function record(tabId,type,detail=''){state.events.push({at:new Date().toISOString(),tabId,type,detail:String(detail).slice(0,150)});state.events=state.events.slice(-3000);}
function eligible(url){try{const u=new URL(url);return ['chatgpt.com','chat.openai.com'].includes(u.hostname) && /^\/(c\/|g\/[^/]+\/c\/)/.test(u.pathname)}catch{return false}}
async function observe(id){try{return await chrome.tabs.sendMessage(id,{type:'INSPECT'});}catch{return null;}}
function keyEvent(type,key,code,keyCode){return chrome.debugger.sendCommand({tabId:this},'Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});}
async function press(id,key,code,keyCode){await chrome.debugger.sendCommand({tabId:id},'Input.dispatchKeyEvent',{type:'rawKeyDown',key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});await chrome.debugger.sendCommand({tabId:id},'Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function sendSequence(id,obs,entry) {
  let attached=false, entered=false;
  try {
    // Persist the pre-Enter phase. Any interrupted send must not automatically replay.
    entry.phase='preparing';entry.reason='Focusing composer';await persist();
    await chrome.debugger.attach({tabId:id},'1.3');attached=true;
    const second=await observe(id);
    if(!second || second.busy || !second.complete || !second.ready || second.draft || !second.composer || second.lastUser!==obs.lastUser)
      throw Error('State changed before click');
    const {x,y}=second.rect;
    await chrome.debugger.sendCommand({tabId:id},'Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
    await chrome.debugger.sendCommand({tabId:id},'Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
    await press(id,'ArrowUp','ArrowUp',38);await sleep(150);
    const recalled=await observe(id);
    if(!recalled || recalled.busy || !recalled.composerText || recalled.composerText.trim()!==obs.prompt.trim())
      throw Error('ArrowUp did not recall the expected message');
    // Enter boundary is persisted BEFORE dispatch, so a worker crash cannot replay it.
    entry.phase='sending';entry.baseline={users:obs.users,assistant:obs.assistant,prompt:obs.lastUser};
    entry.lastSentAt=Date.now();await persist();
    entered=true;
    await press(id,'Enter','Enter',13);
    entry.phase='await_ack';entry.count++;entry.reason='Enter sent; awaiting acknowledgement';
    record(id,'sent','ArrowUp + Enter');await persist();
  } catch(e) {
    if(entered || entry.phase==='sending'){
      entry.phase='review';entry.reason='Enter delivery may be uncertain: '+e.message;
      record(id,'review',entry.reason);
    } else {
      entry.phase='watching';entry.retryAfter=Date.now()+10000;
      entry.reason='Skipped: '+e.message;record(id,'skip',entry.reason);
    }
    await persist();
  } finally {
    if(attached){try{await chrome.debugger.detach({tabId:id})}catch{}}
  }
}
async function scan(id) {
  if(!state.running || busyTabs.has(id))return;
  busyTabs.add(id);
  try {
    const t=await chrome.tabs.get(id).catch(()=>null);
    if(!t || t.windowId!==state.windowId || !eligible(t.url))return;
    let entry=state.tabs[id] ||= AutopilotCore.initial(id);
    const obs=await observe(id);
    if(entry.phase==='ready') entry.phase='watching';
    const next=AutopilotCore.decide(entry,obs);
    if(next.reason!==entry.reason || next.phase!==entry.phase)record(id,next.phase,next.reason);
    state.tabs[id]=entry=next;await persist();
    if(entry.phase==='ready' && obs)await sendSequence(id,obs,entry);
  }catch(e){record(id,'scan_error',e.message);await persist()}finally{busyTabs.delete(id);}
}
async function all() {
  if(!state.running)return;
  const tabs=await chrome.tabs.query({windowId:state.windowId});
  await Promise.all(tabs.filter(t=>eligible(t.url)).map(t=>scan(t.id)));
}
function schedule(id){if(!state.running||queued.has(id))return;queued.add(id);setTimeout(()=>{queued.delete(id);scan(id)},800);}
chrome.runtime.onMessage.addListener((msg,sender)=>{if(msg?.type==='DOM_CHANGED' && sender.tab?.id)schedule(sender.tab.id)});
chrome.tabs.onUpdated.addListener((id,_info,tab)=>{if(state.running&&tab.windowId===state.windowId)schedule(id)});
chrome.tabs.onRemoved.addListener(id=>{delete state.tabs[id];record(id,'closed');persist()});
chrome.action.onClicked.addListener(async tab=>{
  if(state.running){state.running=false;record(null,'stopped');await persist();await chrome.action.setBadgeText({text:''});return}
  state.running=true;state.windowId=tab.windowId;state.tabs={};record(null,'started','window '+tab.windowId);
  await persist();await chrome.action.setBadgeText({text:'ON'});await all();
});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='watchdog')all()});
chrome.runtime.onInstalled.addListener(async()=>{await chrome.alarms.create('watchdog',{periodInMinutes:0.5});chrome.contextMenus.create({id:'report',title:'Open activity report',contexts:['action']});});
chrome.contextMenus.onClicked.addListener(m=>{if(m.menuItemId==='report')chrome.runtime.openOptionsPage()});
(async()=>{await restore();await chrome.alarms.create('watchdog',{periodInMinutes:0.5});await chrome.action.setBadgeText({text:state.running?'ON':''});if(state.running)await all()})();
