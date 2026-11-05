'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../core.js');
const NOW=1800000000000;
const ready=()=>({conversation:true,conversationId:'/c/one',loaded:true,hasComposer:true,
  userCount:2,assistantSig:'2:assistant',lastUserSig:'12:prompt',lastRole:'assistant',
  busy:false,completed:true,hasDraft:false,requiresAction:false,ready:true});
function confirm(item,obs=ready(),t=NOW){
  const a=core.decide(item,obs,t);
  assert.equal(a.send,false,'first sample must not send');
  return core.decide(a.item,obs,t+core.CONFIRM_MS+10);
}
function awaiting(phase){
  const item=core.newItem('שיחה',NOW);item.phase=phase;item.conversationId='/c/one';
  item.sentAt=NOW;item.sent=1;item.baseline={conversationId:'/c/one',userCount:2,
    assistantSig:'2:assistant',sentPromptSig:'12:prompt'};return item;
}
test('busy tab skipped, ready tab can send',()=>{
  const a=core.decide(core.newItem('busy'),{...ready(),busy:true,ready:false,completed:false},NOW+1000);
  const b=confirm(core.newItem('ready'),ready(),NOW+1000);
  assert.equal(a.send,false);assert.equal(a.item.phase,'watching');assert.equal(b.send,true);
});
test('idle without positively completed answer is skipped',()=>{
  const r=core.decide(core.newItem('tab'),{...ready(),ready:false,completed:false,
    reason:'אין אישור שסיום התשובה הושלם'},NOW);
  assert.equal(r.send,false);assert.equal(r.item.phase,'watching');
});
test('after evidence of finished response tab can send',()=>{
  let item=core.decide(core.newItem('tab'),{...ready(),busy:true,completed:false,ready:false},NOW).item;
  item=core.decide(item,{...ready(),completed:false,ready:false},NOW+10000).item;
  assert.equal(confirm(item,ready(),NOW+15000).send,true);
});
test('loading, draft, approval and missing composer all skip',()=>{
  for(const bad of [{loaded:false},{hasDraft:true},{requiresAction:true},{hasComposer:false}]){
    const r=core.decide(core.newItem('tab'),{...ready(),...bad},NOW);
    assert.equal(r.send,false,JSON.stringify(bad));
  }
});
test('interrupted pre-Enter recovers to watching, not paused',()=>{
  const x=core.newItem('tab');x.phase='preparing';
  const r=core.decide(x,ready(),NOW);
  assert.equal(r.item.phase,'watching');assert.equal(r.send,false);
  assert.equal(core.decide(r.item,ready(),NOW+1000).send,false);
  assert.equal(confirm(r.item,ready(),NOW+6000).send,true);
});
test('interrupted Enter remains uncertain, no blind resubmission',()=>{
  const x=awaiting('sending');const r=core.decide(x,ready(),NOW+1000);
  assert.equal(r.item.phase,'needs_review');assert.equal(r.send,false);
});
test('Enter dispatched: no second send until acknowledged',()=>{
  const x=awaiting('await_ack');
  for(const t of [NOW+1000,NOW+20000,NOW+40000])assert.equal(core.decide(x,ready(),t).send,false);
});
test('late acknowledgement recovers single tab',()=>{
  let item=core.decide(awaiting('await_ack'),ready(),NOW+70000).item;
  assert.equal(item.phase,'needs_review');
  item=core.decide(item,{...ready(),userCount:3,lastUserSig:'12:prompt',busy:true,ready:false},NOW+71000).item;
  assert.equal(item.phase,'await_reply');
});
test('await_reply never sends during streaming or stable pause without completion',()=>{
  const item=awaiting('await_reply');
  assert.equal(core.decide(item,{...ready(),userCount:3,assistantSig:'3:partial',busy:true,completed:false,ready:false},NOW+10000).send,false);
  assert.equal(core.decide(item,{...ready(),userCount:3,assistantSig:'3:partial',busy:false,completed:false,ready:false},NOW+30000).item.phase,'await_reply');
});
test('completed new assistant is acknowledged before next send',()=>{
  const item=awaiting('await_reply');
  const obs={...ready(),userCount:3,assistantSig:'3:complete'};
  const first=core.decide(item,obs,NOW+5000);
  assert.equal(first.item.phase,'watching');assert.equal(first.send,false);
  assert.equal(confirm(first.item,obs,NOW+5500).send,true);
});
test('mismatched user message holds only one conversation',()=>{
  const r=core.decide(awaiting('await_ack'),{...ready(),userCount:3,lastUserSig:'different'},NOW+5000);
  assert.equal(r.item.phase,'needs_review');
  assert.equal(confirm(core.newItem('other'),ready(),NOW+5000).send,true);
});
test('pending reply can take hours without global timeout',()=>{
  const obs={...ready(),userCount:3,assistantSig:'3:partial',busy:true,ready:false,completed:false};
  assert.equal(core.decide(awaiting('await_reply'),obs,NOW+7200000).item.phase,'await_reply');
});
test('per-tab safety send limit',()=>{
  const x=core.newItem('tab');x.sent=core.MAX_SENDS;
  assert.equal(core.decide(x,ready(),NOW).item.phase,'limit');
});
test('retry after skip uses only short backoff',()=>{
  const x=core.newItem('tab');x.retryAfter=NOW+5000;
  assert.equal(core.decide(x,ready(),NOW).send,false);
  assert.equal(confirm(x,ready(),NOW+5100).send,true);
});

test('completion flicker resets consensus and never sends during active generation',()=>{
  let item=core.newItem('tab');
  item=core.decide(item,ready(),NOW).item;
  item=core.decide(item,{...ready(),busy:true,ready:false,completed:false},NOW+1400).item;
  assert.equal(item.candidateKey,'');
  let r=core.decide(item,ready(),NOW+2500);
  assert.equal(r.send,false);
  r=core.decide(r.item,ready(),NOW+2900);
  assert.equal(r.send,false);
  r=core.decide(r.item,ready(),NOW+4400);
  assert.equal(r.send,true);
});
test('an already-handled assistant completion is never sent twice',()=>{
  const x=core.newItem('tab');
  x.handledCompletionKey='/c/one|2|2:assistant';
  const r=core.decide(x,ready(),NOW);
  assert.equal(r.send,false);
  assert.equal(r.item.phase,'needs_review');
});
test('candidate changes when assistant text changes after apparent completion',()=>{
  let r=core.decide(core.newItem('tab'),ready(),NOW);
  r=core.decide(r.item,{...ready(),assistantSig:'2:updated'},NOW+1000);
  assert.equal(r.send,false);
  r=core.decide(r.item,{...ready(),assistantSig:'2:updated'},NOW+2000);
  assert.equal(r.send,false);
  r=core.decide(r.item,{...ready(),assistantSig:'2:updated'},NOW+2900);
  assert.equal(r.send,true);
});
test('a new completed assistant turn can be sent after previously handled response',()=>{
  const x=core.newItem('tab');
  x.handledCompletionKey='/c/one|2|2:assistant';
  const newer={...ready(),userCount:3,assistantSig:'3:answer2'};
  assert.equal(confirm(x,newer,NOW).send,true);
});
test('restart in sending phase refuses replay even with positive completion',()=>{
  let x=awaiting('sending');
  x.handledCompletionKey='/c/one|2|2:assistant';
  let r=core.decide(x,ready(),NOW+1000);
  assert.equal(r.send,false);
  assert.equal(r.item.phase,'needs_review');
  assert.equal(core.decide(r.item,ready(),NOW+10000).send,false);
});
