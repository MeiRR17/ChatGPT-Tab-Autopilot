'use strict';
const AutopilotCore = (() => {
  const LIMIT = 100;
  function initial(id) {
    return { id, phase:'watching', count:0, baseline:null, lastSentAt:0, retryAfter:0, reason:'' };
  }
  function decide(tab, obs, now=Date.now()) {
    if (tab.phase==='sending') return { ...tab, phase:'review', reason:'Enter delivery uncertain' };
    if (tab.phase==='preparing') return { ...tab, phase:'watching', retryAfter:now+5000, reason:'Interrupted before Enter' };
    if (!obs || !obs.loaded || !obs.conversation || !obs.composer) return { ...tab, reason:'Page not ready' };
    if (tab.phase==='review' || tab.phase==='limit') return tab;
    if (tab.phase==='await_ack') {
      if (obs.users===tab.baseline.users+1 && obs.lastUser===tab.baseline.prompt)
        return { ...tab, phase:'await_reply', reason:'Send acknowledged' };
      if (obs.users>tab.baseline.users || now-tab.lastSentAt>60000)
        return { ...tab, phase:'review', reason:'Cannot verify submitted message' };
      return { ...tab, reason:'Awaiting acknowledgement' };
    }
    if (tab.phase==='await_reply') {
      if (obs.users!==tab.baseline.users+1 || obs.lastUser!==tab.baseline.prompt)
        return { ...tab, phase:'review', reason:'Conversation changed unexpectedly' };
      if (obs.assistant!==tab.baseline.assistant && obs.complete && !obs.busy) 
        return { ...tab, phase:'watching', baseline:null, reason:'Reply completed', retryAfter:now+1500 };
      return { ...tab, reason:'Reply still in progress' };
    }
    if (tab.count>=LIMIT) return { ...tab, phase:'limit', reason:'Safety limit reached' };
    if (obs.busy || obs.draft || obs.dialog || !obs.complete || !obs.ready || now<tab.retryAfter)
      return { ...tab, reason:'Skipping: generating, unavailable or waiting' };
    if (!obs.prompt || !/^(תמשיך|המשך|continue|keep going)\b/i.test(obs.prompt.trim()))
      return { ...tab, reason:'Last prompt not an approved continuation' };
    return { ...tab, phase:'ready', reason:'Completion confirmed' };
  }
  return { initial, decide, LIMIT };
})();
if (typeof self!=='undefined') self.AutopilotCore=AutopilotCore;
if (typeof module!=='undefined') module.exports=AutopilotCore;
