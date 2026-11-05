'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const Core=require('../core.js');
const OBS={conversation:true,conversationId:'/c/one',loaded:true,hasComposer:true,
  busy:false,completed:true,ready:true,userCount:1,assistantSig:'1:answer',lastUserSig:'8:hello',
  lastRole:'assistant',hasDraft:false,requiresAction:false};
function harness(phase='watching',options={}){
  const writes={};
  const item=Core.newItem('tab');item.phase=phase;item.conversationId='/c/one';
  const state={enabled:true,session:'unit-session',windowId:2,tabIds:[7],
    items:{7:item},discardFlags:{},reason:''};
  writes.autopilot5_state=state;
  const commands=[];let injections=0;let afterUpCalls=0;
  let url=options.url||'https://chatgpt.com/c/one';
  let before=0, mouseReleases=0;
  const handlers={};
  const event=name=>({addListener:fn=>{handlers[name]=fn}});
  const chrome={
    storage:{local:{get:async key=>{
      const result={};for(const k of (Array.isArray(key)?key:[key]))result[k]=writes[k];return result;
    },set:async values=>{Object.assign(writes,values)}}},
    tabs:{get:async()=>({id:7,url,windowId:2,discarded:false}),
      query:async()=>[
        ...(options.otherChatTab ? [{id:options.otherChatTab.id,url:options.otherChatTab.url,windowId:2,discarded:false}] : []),
        {id:7,url,windowId:2,discarded:false}
      ],
      sendMessage:async(id,msg)=>{
        switch(msg.type){
          case 'AP5_INSPECT':if(options.inspectionFailure)throw Error('No receiver');
            if(options.rotationAck && url.endsWith('/c/new')) return {...OBS,conversationId:'/c/new',userCount:1,lastUserSig:'rendered:hash',lastUserSemanticSig:'seed:hash',lastRole:'user'};
            return {...OBS};
          case 'AP5_PREPARE':return options.failPrepare ? {ok:false,reason:'Still generating'} : {ok:true,x:30,y:30};
          case 'AP5_AFTER_CLICK':return {ok:true};
          case 'AP5_AFTER_UP':afterUpCalls++;return {ok:!options.failAfterUp && afterUpCalls >= (options.readyAfterUpCheck||1), reason:(options.failAfterUp?'Completion gate failed':'Send control not enabled yet'),editorEmpty:!options.cleanupSafe};
          case 'AP5_BEFORE_ENTER':before++;return {ok:before!==(options.failBeforeEnterAt||-1)};
          case 'AP5_CLEANUP_CHECK':return {ok:!!options.cleanupSafe,modifier:options.cleanupModifier||'Control'};
          case 'AP5_ROLLOVER_CAPTURE':return {ok:true,prompt:'תמשיך את הפיתוח',assistantExcerpt:'The project compiles and the tests pass.'};
          case 'AP5_FIND_NEW_CHAT':return options.missingNewChat ? {ok:false,reason:'No visible New Chat control'} : {ok:true,x:90,y:20};
          case 'AP5_NEW_CHAT_PREPARE':return {ok:!options.newChatUnavailable,x:30,y:30};
          case 'AP5_NEW_CHAT_FOCUSED':return {ok:true};
          case 'AP5_NEW_CHAT_VERIFY':return options.rotationNotReady ? {ok:false,reason:'Not ready'} : {ok:true,seedSig:'seed:hash'};
          case 'AP5_BOOTSTRAP_PREPARE':return {ok:!options.bootstrapNotReady,x:20,y:30};
          case 'AP5_BOOTSTRAP_FOCUSED':return {ok:true};
          case 'AP5_BOOTSTRAP_VERIFY':return {ok:!options.bootstrapNotReady,promptSig:'bootstrap:hash'};
          default:return {ok:true};
        }
      },onRemoved:event('removed'),onUpdated:event('updated')},
    debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(target,method,args)=>{
      commands.push({method,args});
      if(method==='Input.dispatchMouseEvent' && args.type==='mouseReleased') {
        mouseReleases++;
        if(options.rotationAck && mouseReleases===2)url='https://chatgpt.com/';
      }
      if(method==='Input.dispatchKeyEvent' && args.key==='Enter' && args.type==='keyDown' && options.rotationAck && mouseReleases===3) url='https://chatgpt.com/c/new';
    }},
    action:{onClicked:event('clicked'),setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},
    runtime:{id:'extension-id',onMessage:event('message'),onInstalled:event('installed'),onStartup:event('startup')},
    alarms:{onAlarm:event('alarm'),create:async()=>{},clear:async()=>{}},
    contextMenus:{onClicked:event('menu'),create:()=>{},removeAll:async()=>{}},
    scripting:{executeScript:async()=>{injections++}}
  };
  const globals={chrome,URL,crypto:{randomUUID:()=> 'uuid'},console,setTimeout,clearTimeout,
    importScripts:()=>{}};
  const context=vm.createContext(globals);
  context.importScripts=(...names)=>names.forEach(name=>vm.runInContext(
    fs.readFileSync(path.join(ROOT,name),'utf8'),context,{filename:name}));
  vm.runInContext(fs.readFileSync(path.join(ROOT,'background.js'),'utf8'),context,
    {filename:'background.js'});
  return {context,writes,commands,getInjections:()=>injections,getAfterUpCalls:()=>afterUpCalls,
    setUrl:x=>{url=x},getItem:()=>writes.autopilot5_state.items[7]};
}
test('ordinary navigation away skips without putting the tab in needs_review',async()=>{
  const h=harness('watching',{url:'https://chatgpt.com/'});
  await vm.runInContext('scanOne(7)',h.context);
  assert.equal(h.getItem().phase,'watching');
  assert.match(h.getItem().status,/skipping/i);
  h.setUrl('https://chatgpt.com/c/one');
  await vm.runInContext('scanOne(7)',h.context);
  assert.equal(h.getItem().phase,'watching');
  assert.notEqual(h.getItem().status,'Tab changed');
});
test('navigation with a pending Enter keeps only that conversation in review',async()=>{
  const h=harness('await_ack',{url:'https://chatgpt.com/'});
  await vm.runInContext('scanOne(7)',h.context);
  assert.equal(h.getItem().phase,'needs_review');
  assert.equal(h.commands.length,0);
});
test('post-persistence completion regression skips and dispatches no Enter',async()=>{
  const h=harness('preparing',{failBeforeEnterAt:2});
  const result=await vm.runInContext(`act(7,'unit-session',${JSON.stringify(OBS)})`,h.context);
  assert.equal(result.kind,'hold');
  assert.match(result.reason,/Enter NOT sent/);
  assert.equal(h.getItem().phase,'preparing');
  assert.equal(h.getItem().handledCompletionKey,'');
  assert.equal(h.commands.filter(c=>c.method==='Input.dispatchKeyEvent' && c.args.key==='Enter').length,0);
  assert.equal(h.commands.filter(c=>c.method==='Input.dispatchKeyEvent' && c.args.key==='ArrowUp' && c.args.type==='keyDown').length,1);
});
test('all completed safety gates allow exactly one real Enter keyDown',async()=>{
  const h=harness('preparing');
  const result=await vm.runInContext(`act(7,'unit-session',${JSON.stringify(OBS)})`,h.context);
  assert.equal(result.kind,'sent');
  assert.equal(h.getItem().phase,'sending');
  assert.equal(h.commands.filter(c=>c.method==='Input.dispatchKeyEvent' && c.args.key==='Enter' && c.args.type==='keyDown').length,1);
});

test('failed final gate NEVER deletes a recalled prompt and never sends Enter',async()=>{
  const h=harness('preparing',{failBeforeEnterAt:2,cleanupSafe:true});
  const result=await vm.runInContext(`act(7,'unit-session',${JSON.stringify(OBS)})`,h.context);
  assert.equal(result.kind,'hold');
  assert.match(result.reason,/composer preserved/);
  const keys=h.commands.filter(c=>c.method==='Input.dispatchKeyEvent').map(c=>c.args);
  assert.equal(keys.filter(k=>k.key==='Enter').length,0);
  assert.equal(keys.filter(k=>k.key==='Backspace').length,0);
  assert.equal(keys.filter(k=>k.key==='Control'||k.key==='Meta').length,0);
});
test('human draft and canceled Enter never receive deletion input',async()=>{
  const h=harness('preparing',{failBeforeEnterAt:2,cleanupSafe:false});
  await vm.runInContext(`act(7,'unit-session',${JSON.stringify(OBS)})`,h.context);
  assert.equal(h.commands.filter(c=>['Backspace','Escape','a'].includes(c.args.key)).length,0);
  assert.equal(h.commands.filter(c=>c.args.key==='Enter').length,0);
});

test('missing content script is reinjected at most once per 10-second window',async()=>{
  const h=harness('watching',{inspectionFailure:true});
  await vm.runInContext('scanOne(7)',h.context);
  await vm.runInContext('scanOne(7)',h.context);
  assert.equal(h.getInjections(),1);
  assert.equal(h.getItem().phase,'watching');
});

test('failed AFTER_UP gate holds only this tab and NEVER wipes text',async()=>{
  const h=harness('preparing',{failAfterUp:true,cleanupSafe:true});
  const result=await vm.runInContext(`act(7,'unit-session',${JSON.stringify(OBS)})`,h.context);
  assert.equal(result.kind,'hold');
  const keys=h.commands.filter(c=>c.method==='Input.dispatchKeyEvent').map(c=>c.args);
  assert.equal(keys.filter(k=>k.key==='ArrowUp'&&k.type==='keyDown').length,1);
  assert.equal(keys.filter(k=>k.key==='Enter').length,0);
  assert.equal(keys.filter(k=>['Backspace','Escape','a'].includes(k.key)).length,0);
  assert.equal(h.getAfterUpCalls(),12);
});
test('temporary Send-button update can settle without ArrowUp repetition',async()=>{
  const h=harness('preparing',{readyAfterUpCheck:3});
  const result=await vm.runInContext(`act(7,'unit-session',${JSON.stringify(OBS)})`,h.context);
  assert.equal(result.kind,'sent');
  assert.equal(h.getAfterUpCalls(),3);
  assert.equal(h.commands.filter(c=>c.args.key==='ArrowUp'&&c.args.type==='keyDown').length,1);
  assert.equal(h.commands.filter(c=>c.args.key==='Enter'&&c.args.type==='keyDown').length,1);
  assert.equal(h.commands.filter(c=>c.args.key==='Backspace').length,0);
});
test('failed AFTER_UP does not repeatedly press ArrowUp on subsequent scans',async()=>{
  const h=harness('preparing',{failAfterUp:true});
  const r=await vm.runInContext(`act(7,'unit-session',${JSON.stringify(OBS)})`,h.context);
  assert.equal(r.kind,'hold');
  h.getItem().phase='needs_review';
  await vm.runInContext('scanOne(7)',h.context);
  assert.equal(h.getItem().phase,'needs_review');
  assert.equal(h.commands.filter(c=>c.args.key==='ArrowUp'&&c.args.type==='keyDown').length,1);
});

test('navigating away while awaiting an acknowledged reply remains retryable',async()=>{
  const h=harness('await_reply',{url:'https://chatgpt.com/'});
  h.getItem().baseline={conversationId:'/c/one',userCount:0,assistantSig:OBS.assistantSig,sentPromptSig:OBS.lastUserSig};
  await vm.runInContext('scanOne(7)',h.context);
  assert.equal(h.getItem().phase,'await_reply');
  h.setUrl('https://chatgpt.com/c/one');
  await vm.runInContext('scanOne(7)',h.context);
  assert.equal(h.getItem().phase,'await_reply');
});


test('duplicate conversation is skipped before any mouse or keyboard input',async()=>{
  const h=harness('preparing',{otherChatTab:{id:5,url:'https://chatgpt.com/c/one'}});
  h.writes.autopilot5_state.tabIds.push(5);
  const result=await vm.runInContext(`act(7,'unit-session',${JSON.stringify(OBS)})`,h.context);
  assert.equal(result.kind,'skip');
  assert.match(result.reason,/Duplicate conversation/i);
  assert.equal(h.commands.length,0);
});
test('lower-ID owner remains eligible when the same chat is open twice',async()=>{
  const h=harness('preparing',{otherChatTab:{id:12,url:'https://chatgpt.com/c/one'}});
  h.writes.autopilot5_state.tabIds.push(12);
  const result=await vm.runInContext(`act(7,'unit-session',${JSON.stringify(OBS)})`,h.context);
  assert.equal(result.kind,'sent');
  assert.equal(h.commands.filter(c=>c.args.key==='Enter' && c.args.type==='keyDown').length,1);
});
test('owner navigating to another conversation safely promotes the remaining tab',async()=>{
  const h=harness('preparing',{otherChatTab:{id:5,url:'https://chatgpt.com/c/other'}});
  h.writes.autopilot5_state.tabIds.push(5);
  const result=await vm.runInContext(`act(7,'unit-session',${JSON.stringify(OBS)})`,h.context);
  assert.equal(result.kind,'sent');
});
test('a duplicate watching tab never clicks while the primary is alive',async()=>{
  const h=harness('watching',{otherChatTab:{id:5,url:'https://chatgpt.com/c/one'}});
  h.writes.autopilot5_state.tabIds.push(5);
  await vm.runInContext('scanOne(7)',h.context);
  assert.equal(h.getItem().phase,'watching');
  assert.match(h.getItem().status,/Duplicate conversation/);
  assert.equal(h.commands.length,0);
});


test('durable global completion claim blocks other copy even after original tab closed',async()=>{
  const h=harness('watching');
  const key=`${OBS.conversationId}|${OBS.userCount}|${OBS.assistantSig}`;
  h.writes.autopilot5_state.handledGlobally={[key]:{tabId:5,claimedAt:Date.now()}};
  await vm.runInContext('scanOne(7)',h.context);
  assert.equal(h.getItem().phase,'watching');
  assert.match(h.getItem().status,/already handled/);
  assert.equal(h.commands.length,0);
});
test('successful Enter persists one global completion claim',async()=>{
  const h=harness('preparing');
  const r=await vm.runInContext(`act(7,'unit-session',${JSON.stringify(OBS)})`,h.context);
  assert.equal(r.kind,'sent');
  const key=`${OBS.conversationId}|${OBS.userCount}|${OBS.assistantSig}`;
  assert.equal(h.writes.autopilot5_state.handledGlobally[key].tabId,7);
});
test('failed post-persistence gate rolls back global claim before any Enter',async()=>{
  const h=harness('preparing',{failBeforeEnterAt:2});
  const r=await vm.runInContext(`act(7,'unit-session',${JSON.stringify(OBS)})`,h.context);
  assert.equal(r.kind,'hold');
  assert.deepEqual(Object.keys(h.writes.autopilot5_state.handledGlobally||{}),[]);
  assert.equal(h.commands.some(c=>c.args.key==='Enter'),false);
});


test('new-chat rollover does not click anything if chat is not ready', async()=>{
  const h=harness('preparing',{failPrepare:true});
  const out=await vm.runInContext("rotateChat(7,'unit-session',"+JSON.stringify({...OBS,ready:false})+",{rotateDelayMs:0})",h.context);
  // The prepare mock succeeds; the content-script safety check is the final authority.
  assert.equal(out.kind,'skip');
  assert.equal(h.commands.filter(x=>x.args.key==='Enter').length,0);
});
test('new-chat rollover skips when New Chat button is absent and never presses Enter', async()=>{
  const h=harness('preparing',{cleanupSafe:true,missingNewChat:true});
  const out=await vm.runInContext("rotateChat(7,'unit-session',"+JSON.stringify(OBS)+",{rotateDelayMs:0})",h.context);
  assert.equal(out.kind,'hold');assert.match(out.reason,/New Chat/);
  assert.equal(h.commands.filter(x=>x.args.key==='Enter').length,0);
  assert.equal(h.commands.filter(x=>x.method==='Input.insertText').length,0);
});
test('verified rollover is click ArrowUp -> New Chat click -> new-editor input -> Enter', async()=>{
  const h=harness('preparing',{cleanupSafe:true,rotationAck:true});
  const out=await vm.runInContext("rotateChat(7,'unit-session',"+JSON.stringify(OBS)+",{rotateDelayMs:0})",h.context);
  assert.equal(out.kind,'rotated',out.reason);assert.equal(out.seedSig,'seed:hash');
  assert.equal(h.commands.filter(c=>c.args.key==='Backspace'||c.args.key==='Control'||c.args.key==='Meta').length,0);
  const actions=h.commands.filter(x=>x.method==='Input.dispatchKeyEvent' || x.method==='Input.insertText' || (x.method==='Input.dispatchMouseEvent'&&x.args.type==='mouseReleased'));
  const idxUp=actions.findIndex(x=>x.args.key==='ArrowUp' && x.args.type==='keyDown');
  const idxNew=actions.findIndex((x,i)=>i>idxUp && x.method==='Input.dispatchMouseEvent' && x.args.x===90);
  const idxInsert=actions.findIndex(x=>x.method==='Input.insertText');
  const idxEnter=actions.findIndex(x=>x.args.key==='Enter' && x.args.type==='keyDown');
  assert.ok(idxUp>=0 && idxNew>idxUp && idxInsert>idxNew && idxEnter>idxInsert);
  assert.match(actions[idxInsert].args.text,/Previous assistant response/);
  assert.equal(actions.filter(x=>x.args.key==='Enter'&&x.args.type==='keyDown').length,1);
});
test('rotation result is acknowledged without an automatic duplicate Enter',async()=>{
  const h=harness('await_new_chat',{rotationAck:true,url:'https://chatgpt.com/c/new'});
  const item=h.getItem();item.rotationSeedSig='seed:hash';item.rotationOldId='/c/one';item.rotationStartedAt=Date.now();
  await vm.runInContext('scanOne(7)',h.context);
  assert.equal(item.phase,'await_reply');
  assert.equal(item.conversationId,'/c/new');
  assert.equal(h.commands.filter(x=>x.args.key==='Enter').length,0);
});
test('ambiguous new chat remains isolated and never retries Enter',async()=>{
  const h=harness('await_new_chat',{url:'https://chatgpt.com/'});
  const item=h.getItem();item.rotationSeedSig='seed:hash';item.rotationStartedAt=Date.now();
  await vm.runInContext('scanOne(7)',h.context);
  assert.equal(item.phase,'await_new_chat');
  assert.equal(h.commands.length,0);
});
test('rollover settings are bounded and default to ten continuations',async()=>{
  const h=harness();
  const defaults=await vm.runInContext('getSettings()',h.context);
  assert.equal(defaults.rotateAfter,10);assert.equal(defaults.rotateDelayMs,3500);
  h.writes.autopilot5_settings={rotateEnabled:true,rotateAfter:999,rotateDelayMs:0};
  const bounded=await vm.runInContext('getSettings()',h.context);
  assert.equal(bounded.rotateAfter,100);assert.equal(bounded.rotateDelayMs,2000);
});


test('bootstrapping new chat creates short follow-up, not another long seed',async()=>{
  const h=harness('preparing');
  h.getItem().bootstrapPending=true;h.getItem().bootstrapLanguage='he';
  const result=await vm.runInContext("bootstrapChat(7,'unit-session',"+JSON.stringify(OBS)+",'he')",h.context);
  assert.equal(result.kind,'bootstrapped',result.reason);
  const injected=h.commands.filter(c=>c.method==='Input.insertText');
  assert.equal(injected.length,1);assert.equal(injected[0].args.text,'תמשיך את הפיתוח');
  assert.equal(h.commands.filter(c=>c.args.key==='ArrowUp').length,0);
  assert.equal(h.commands.filter(c=>c.args.key==='Enter'&&c.args.type==='keyDown').length,1);
  assert.equal(h.getItem().baseline.sentPromptSig,'bootstrap:hash');
});
test('bootstrap missing completion gate skips and sends no Enter or inserted text',async()=>{
  const h=harness('preparing',{bootstrapNotReady:true});
  const result=await vm.runInContext("bootstrapChat(7,'unit-session',"+JSON.stringify(OBS)+",'he')",h.context);
  assert.equal(result.kind,'skip');
  assert.equal(h.commands.filter(c=>c.args.key==='Enter').length,0);
  assert.equal(h.commands.filter(c=>c.method==='Input.insertText').length,0);
});
test('bootstrap interruption after insertion holds only that chat',async()=>{
  const h=harness('preparing',{bootstrapNotReady:true});
  // The initial ready gate passes; the second verify fails after text injection.
  h.writes.autopilot5_state.items[7].bootstrapPending=true;
  const script='bootstrapChat(7,"unit-session",'+JSON.stringify(OBS)+',"he")';
  const out=await vm.runInContext(script,h.context);
  assert.equal(out.kind,'skip');
  assert.equal(h.commands.filter(c=>c.args.key==='Enter').length,0);
});
