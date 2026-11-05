'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../core.js');
const NOW=1800000000000;
const ready=()=>({
  conversation:true,conversationId:'/c/legacy-coverage',loaded:true,hasComposer:true,
  userCount:1,assistantSig:'1:finished',lastUserSig:'8:continue',lastRole:'assistant',
  busy:false,completed:true,hasDraft:false,requiresAction:false,ready:true
});
function existing(phase='watching'){
  const item=Core.newItem('Legacy contract migrated',NOW);
  item.phase=phase;item.conversationId='/c/legacy-coverage';return item;
}
function pending(phase){
  const item=existing(phase);item.sentAt=NOW;item.baseline={
    conversationId:'/c/legacy-coverage',userCount:1,assistantSig:'1:finished',sentPromptSig:'8:continue'
  };
  return item;
}
test('busy tab is skipped without stopping other tabs',()=>{
  const result=Core.decide(existing(),{...ready(),busy:true,ready:false},NOW);
  assert.equal(result.item.phase,'watching');assert.equal(result.send,false);
});
test('positive completed response evidence is required',()=>{
  const result=Core.decide(existing(),{...ready(),completed:false,ready:false},NOW);
  assert.equal(result.item.phase,'watching');assert.equal(result.send,false);
});
test('a completed continuation requires two independent samples',()=>{
  const first=Core.decide(existing(),ready(),NOW);
  assert.equal(first.send,false);
  const second=Core.decide(first.item,ready(),NOW+Core.CONFIRM_MS+100);
  assert.equal(second.send,true);
});
test('uncertain Enter is held for review, not blindly retried',()=>{
  const result=Core.decide(pending('sending'),ready(),NOW+1000);
  assert.equal(result.item.phase,'needs_review');assert.equal(result.send,false);
});
test('an acknowledged user message transitions to awaiting reply',()=>{
  const result=Core.decide(pending('await_ack'),{...ready(),userCount:2},NOW+1000);
  assert.equal(result.item.phase,'await_reply');assert.equal(result.send,false);
});
test('an active response does not trigger Enter while waiting for the reply',()=>{
  const result=Core.decide(pending('await_reply'),{
    ...ready(),userCount:2,assistantSig:'2:partial',busy:true,completed:false,ready:false
  },NOW+1000);
  assert.equal(result.item.phase,'await_reply');assert.equal(result.send,false);
});
