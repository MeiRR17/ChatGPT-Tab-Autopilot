'use strict';
// Deterministic state machine: NO global abort when one tab is busy or unavailable.
const AutopilotCore = (() => {
  const ACK_TIMEOUT_MS=60000, MAX_SENDS=100, CONFIRM_MS=1800;
  function newItem(name,now=Date.now()){
    return {name:String(name||'Conversation').slice(0,100),phase:'watching',status:'Waiting for scan',
      reason:'',sent:0,lastUpdatedAt:now,lastActionAt:0,sentAt:0,retryAfter:0,
      baseline:null,conversationId:'',candidateKey:'',candidateAt:0,handledCompletionKey:''};
  }
  // Windowed conversation DOMs may keep the same visible user count after a
  // new user turn. Prefer a stable user message ID when it is available.
  function acknowledged(obs,baseline){
    if(!baseline || obs.lastUserSig!==baseline.sentPromptSig)return false;
    if(obs.lastUserId && baseline.lastUserId)
      return obs.lastUserId!==baseline.lastUserId;
    return obs.userCount===baseline.userCount+1;
  }
  function unexpectedUser(obs,baseline){
    if(obs.lastUserId && baseline.lastUserId)
      return obs.lastUserId!==baseline.lastUserId && obs.lastUserSig!==baseline.sentPromptSig;
    return obs.userCount>baseline.userCount && obs.lastUserSig!==baseline.sentPromptSig;
  }
  function decide(prev,obs,now=Date.now()){ 
    const item={...prev};
    const out={item,send:false,event:'',level:'info'};
    const transition=(phase,status,event='',reason='')=>{
      if(item.phase!==phase||item.status!==status||item.reason!==reason){
        item.phase=phase;item.status=status;item.reason=reason;item.lastUpdatedAt=now;out.event=event;
      }
    };
    const review=(reason,event)=>{
      transition('needs_review','Uncertain delivery; only this conversation needs review',event,reason);out.level='warning';
    };
    if(item.phase==='preparing'){
      // The worker disappeared BEFORE the Enter boundary. An auto-retry is permitted
      // only once the composer is visibly empty and the conversation is unchanged.
      transition('watching','Previous action interrupted before Enter; rechecking','pre_enter_recovered');
      item.retryAfter=now+5000;
      return out;
    }
    if(item.phase==='sending'){
      // Enter may have been delivered. Never replay it from uncertain state.
      review('Extension interrupted near Enter; do not resend without acknowledgement','uncertain_enter');
    }
    if(!obs || !obs.conversation || !obs.loaded || !obs.hasComposer){
      if(item.phase==='watching')transition('watching','Tab not ready; skip','waiting_page');
      return out;
    }
    if(item.conversationId && obs.conversationId!==item.conversationId){
      if(['await_ack','await_reply','needs_review'].includes(item.phase) && item.baseline){
        review('Conversation changed after send attempt','conversation_changed');return out;
      }
      item.conversationId=obs.conversationId;
      item.candidateKey=''; item.candidateAt=0;
      transition('watching','Conversation changed; waiting for stability','conversation_changed');
      return out;
    }
    item.conversationId ||= obs.conversationId;
    if(item.phase==='needs_review'){
      // Late acknowledgement automatically recovers a formerly uncertain Enter.
      if(item.baseline && item.sentAt && acknowledged(obs,item.baseline) && obs.conversationId===item.conversationId){
        transition('await_reply','Message acknowledged; waiting for completed reply','late_ack_recovered');
      }
      return out;
    }
    if(item.phase==='limit')return out;
    if(item.phase==='await_ack'){
      if(!item.baseline){review('Send verification baseline missing','missing_baseline');return out;}
      if(acknowledged(obs,item.baseline)){
        transition('await_reply','Message acknowledged; awaiting reply','send_acknowledged');
      } else if(unexpectedUser(obs,item.baseline)){
        review('Different user message appeared after send','ack_mismatch');
      } else if(now-item.sentAt>ACK_TIMEOUT_MS){
        review('Enter not acknowledged; refusing duplicate send','ack_timeout');
      }
      return out;
    }
    if(item.phase==='await_reply'){
      if(!item.baseline){review('Reply baseline missing','missing_baseline');return out;}
      if(!acknowledged(obs,item.baseline)){
        review('User message changed while awaiting reply','external_interference');return out;
      }
      const newAssistant=!!obs.assistantSig && obs.assistantSig!==item.baseline.assistantSig;
      if(newAssistant && (obs.ready || (item.bootstrapPending && obs.loaded && obs.stable && obs.completed && obs.hasComposer && !obs.hasDraft && !obs.requiresAction)) && obs.completed && !obs.busy && obs.lastRole==='assistant'){
        item.baseline=null; item.candidateKey=''; item.candidateAt=0;
        transition('watching','Reply completed; eligible for rescan','reply_completed');
        return out;
      }
      transition('await_reply',obs.busy?'ChatGPT generating; skipping':'Waiting for positive reply completion',
        obs.busy?'generation_active':'waiting_completion');
      return out;
    }
    if(item.sent>=MAX_SENDS){transition('limit','Per-conversation safety limit reached','safety_limit');return out;}
    // All of these are routine SKIPS, not a pause, stop or global error.
    if(obs.busy){item.candidateKey='';item.candidateAt=0;transition('watching','ChatGPT generating; skipping','generation_active');return out;}
    if(obs.hasDraft){transition('watching','Draft detected; skipping','draft_detected');return out;}
    if(obs.requiresAction){transition('watching','Manual action required; skipping','manual_action');return out;}
    if(!obs.ready || !obs.completed){
      item.candidateKey='';item.candidateAt=0;
      transition('watching',obs.reason||'Completion unconfirmed; skipping','not_ready');return out;
    }
    if((item.retryAfter||0)>now){
      transition('watching','Temporary skip; waiting to retry','retry_cooldown');return out;
    }
    // Independent samples must confirm the *same* completed assistant turn.
    // A fleeting finished UI or transiently missing Stop button cannot arm Enter.
    const completionKey = `${obs.conversationId}|${obs.userCount}|${obs.assistantSig}`;
    if(item.handledCompletionKey===completionKey){
      transition('needs_review','Completion already handled; refusing duplicate Enter',
        'duplicate_completion_blocked','A send was already attempted for this exact response');
      out.level='warning';return out;
    }
    if(item.candidateKey!==completionKey){
      item.candidateKey=completionKey;item.candidateAt=now;
      transition('watching','Confirming completed response across samples','completion_candidate');
      return out;
    }
    if(now-item.candidateAt<CONFIRM_MS){
      transition('watching','Confirming completed response across samples');return out;
    }
    transition('watching','Completed response independently confirmed; ready to send','ready');
    out.send=true;return out;
  }
  return {newItem,decide,ACK_TIMEOUT_MS,MAX_SENDS,CONFIRM_MS};
})();
if(typeof self!=='undefined')self.AutopilotCore=AutopilotCore;
if(typeof module!=='undefined')module.exports=AutopilotCore;
