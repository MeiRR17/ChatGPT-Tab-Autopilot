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
  const commands=[];let injections=0;
  let url=options.url||'https://chatgpt.com/c/one';
  let before=0;
  const handlers={};
  const event=name=>({addListener:fn=>{handlers[name]=fn}});
  const chrome={
    storage:{local:{get:async key=>{
      const result={};for(const k of (Array.isArray(key)?key:[key]))result[k]=writes[k];return result;
    },set:async values=>{Object.assign(writes,values)}}},
    tabs:{get:async()=>({id:7,url,windowId:2,discarded:false}),
      sendMessage:async(id,msg)=>{
        switch(msg.type){
          case 'AP5_INSPECT':if(options.inspectionFailure)throw Error('No receiver');return {...OBS};
          case 'AP5_PREPARE':return {ok:true,x:30,y:30};
          case 'AP5_AFTER_CLICK':return {ok:true};
          case 'AP5_AFTER_UP':return {ok:true};
          case 'AP5_BEFORE_ENTER':before++;return {ok:before!==(options.failBeforeEnterAt||-1)};
          case 'AP5_CLEANUP_CHECK':return {ok:!!options.cleanupSafe,modifier:options.cleanupModifier||'Control'};
          default:return {ok:true};
        }
      },onRemoved:event('removed'),onUpdated:event('updated')},
    debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(target,method,args)=>{
      commands.push({method,args});
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
  return {context,writes,commands,getInjections:()=>injections,
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
  assert.equal(result.kind,'skip');
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

test('failed final gate clears ONLY a verified recalled prompt, never sends Enter',async()=>{
  const h=harness('preparing',{failBeforeEnterAt:2,cleanupSafe:true});
  const result=await vm.runInContext(`act(7,'unit-session',${JSON.stringify(OBS)})`,h.context);
  assert.equal(result.kind,'skip');
  const keys=h.commands.filter(c=>c.method==='Input.dispatchKeyEvent').map(c=>c.args);
  assert.equal(keys.filter(k=>k.key==='Enter').length,0);
  assert.equal(keys.filter(k=>k.key==='Backspace' && k.type==='keyDown').length,1);
  assert.equal(keys.filter(k=>k.key==='Control' && k.type==='rawKeyDown').length,1);
  assert.equal(keys.filter(k=>k.key==='a' && k.modifiers===2).length,2);
});
test('an unverified or human-edited draft is NEVER cleared automatically',async()=>{
  const h=harness('preparing',{failBeforeEnterAt:2,cleanupSafe:false});
  await vm.runInContext(`act(7,'unit-session',${JSON.stringify(OBS)})`,h.context);
  const keys=h.commands.filter(c=>c.method==='Input.dispatchKeyEvent').map(c=>c.args);
  assert.equal(keys.filter(k=>k.key==='Backspace').length,0);
  assert.equal(keys.filter(k=>k.key==='Control').length,0);
  assert.equal(keys.filter(k=>k.key==='Enter').length,0);
});

test('missing content script is reinjected at most once per 10-second window',async()=>{
  const h=harness('watching',{inspectionFailure:true});
  await vm.runInContext('scanOne(7)',h.context);
  await vm.runInContext('scanOne(7)',h.context);
  assert.equal(h.getInjections(),1);
  assert.equal(h.getItem().phase,'watching');
});
