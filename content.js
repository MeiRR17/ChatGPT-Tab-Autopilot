'use strict';
// Read-only DOM inspection. Physical-equivalent input is sent by Chrome debugger in background.js.
(() => {
  if (globalThis.__chatgptAutopilotV5) return;
  globalThis.__chatgptAutopilotV5 = true;
  const STABLE_MS = 5000;
  const PULSE_MS = 2200;
  const norm = s => String(s ?? '').replace(/\u200b/g,'').replace(/\r/g,'').trim();
  const fingerprint = value => {
    const text = String(value ?? ''); let h=2166136261;
    for (const ch of text) { h^=ch.charCodeAt(0); h=Math.imul(h,16777619); }
    return `${text.length}:${(h>>>0).toString(16)}`;
  };
  const onChat = () => /^\/(?:g\/[^/]+\/)?c\/[^/]+/.test(location.pathname);
  const visible = el => !!el && el.isConnected && el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const composerSelectors = ['#prompt-textarea[contenteditable="true"]',
    '[data-testid="composer-text-input"][contenteditable="true"]',
    'form [role="textbox"][contenteditable="true"]', 'form [contenteditable="true"]',
    '#prompt-textarea', 'form textarea'];
  const composer = () => {
    for (const selector of composerSelectors) {
      const el = document.querySelector(selector);
      if (visible(el) && (el.isContentEditable || el instanceof HTMLTextAreaElement)) return el;
    }
    return null;
  };
  const composerText = el => norm(el ? (el.isContentEditable ? el.innerText : el.value) : '');
  function getTurns() {
    // ChatGPT has used both section[data-turn] and data-message-author-role; never mix both lists.
    for (const selector of [
      'section[data-turn="user"], section[data-turn="assistant"]',
      '[data-testid^="conversation-turn-"][data-turn="user"], [data-testid^="conversation-turn-"][data-turn="assistant"]',
      '[data-message-author-role="user"], [data-message-author-role="assistant"]'
    ]) {
      const matches = [...document.querySelectorAll(selector)].filter(visible);
      if (matches.length) return matches;
    }
    return [];
  }
  function role(turn) {
    return turn?.getAttribute('data-turn') || turn?.getAttribute('data-message-author-role') || '';
  }
  function userText(turn) {
    if (!turn) return '';
    const blocks=[...turn.querySelectorAll('[data-testid="user-message"],.whitespace-pre-wrap')];
    const top=blocks.filter(n => !blocks.some(other => other!==n && other.contains(n)));
    return norm(top.length ? top.map(n=>n.innerText||'').join('\n') : turn.innerText||'');
  }
  function permittedPrompt(turn) {
    const text=userText(turn);
    if (!text || text.length>500 || text.includes('\n\n'))
      return {ok:false,reason:'The last user message is not a short continuation request'};
    if (!/^(?:תמשיך|המשך|continue\b|keep going\b)/iu.test(text))
      return {ok:false,reason:'Last user message is not a continuation request'};
    if (turn.querySelector('img,video,audio,[data-testid*="attachment"],[data-testid*="file-upload"]'))
      return {ok:false,reason:'Last request has an attachment'};
    return {ok:true,text};
  }
  function generationActive() {
    const stops=['[data-testid="stop-button"]','[data-testid="stop-generating-button"]',
      '#composer-submit-button[aria-label*="stop" i]', 'button[aria-label*="stop streaming" i]',
      'button[aria-label*="stop generating" i]','button[aria-label*="stop response" i]',
      'button[aria-label="עצור"]', 'button[aria-label="עצור יצירה"]'];
    if(stops.some(sel => [...document.querySelectorAll(sel)].some(visible)))return true;
    if([...document.querySelectorAll('button')].some(b=>visible(b) &&
      /^(stop|stop generating|stop streaming|עצור|עצור יצירה|הפסק יצירה)$/iu.test(
        norm(b.getAttribute('aria-label')||b.textContent))))return true;
    return [...document.querySelectorAll('[aria-busy="true"]')].some(el => visible(el) &&
      (el.matches('[data-message-author-role="assistant"],[data-turn="assistant"],main,[role="main"]') ||
        !!el.closest('[data-message-author-role="assistant"],[data-turn="assistant"]')));
  }
  function completedActions(lastAssistant) {
    if (!lastAssistant) return false;
    // A positive finished-response action must belong to the *last* assistant turn.
    const wrapper=lastAssistant.closest('section[data-turn],[data-testid^="conversation-turn-"],[data-turn-key]') || lastAssistant;
    const actionSelectors=['button[data-testid="copy-turn-action-button"]',
      '[data-turn-key] .turn-action-controls button', '.turn-action-controls button'];
    return actionSelectors.some(sel=>[...wrapper.querySelectorAll(sel)].some(visible));
  }
  function enabledSendControl() {
    // Fail closed if the composer is still showing Stop or an unknown action.
    const selectors = ['button[data-testid="send-button"]', '#composer-submit-button',
      'button[aria-label="Send message"]', 'button[aria-label="Send prompt"]',
      'button[aria-label="שלח הודעה"]'];
    for (const selector of selectors) {
      for (const button of document.querySelectorAll(selector)) {
        if (!visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') continue;
        const label = norm([button.getAttribute('data-testid'),button.getAttribute('aria-label'),
          button.getAttribute('title')].filter(Boolean).join(' '));
        if (/\b(?:stop|cancel|abort)\b|עצור|הפסק/iu.test(label)) continue;
        if (/\bsend\b|שלח/iu.test(label)) return true;
      }
    }
    return false;
  }
  function needsApproval(lastAssistant) {
    if (!lastAssistant) return false;
    return [...lastAssistant.querySelectorAll('button')].some(btn=>visible(btn) &&
      /^(approve|allow|confirm|authorize|grant access|אשר|אפשר גישה)$/iu.test(
        norm(btn.getAttribute('aria-label')||btn.textContent)));
  }
  let monitoring=false, lastPath=location.pathname, lastSignature='', lastTurnCount=-1;
  let lastChangeAt=Date.now(), lastAnnouncement='', notifyTimer=null;
  function inspect() {
    const now=Date.now(), ed=composer(), turns=getTurns();
    const users=turns.filter(n=>role(n)==='user');
    const assistants=turns.filter(n=>role(n)==='assistant');
    const lastA=assistants.at(-1), lastU=users.at(-1), lastRole=role(turns.at(-1));
    const assistantText=norm(lastA?.innerText);
    const assistantSig=lastA ? `${assistants.length}:${fingerprint(assistantText)}` : '';
    const busy=generationActive();
    if(lastPath!==location.pathname || lastSignature!==assistantSig || lastTurnCount!==turns.length){
      lastPath=location.pathname;lastSignature=assistantSig;lastTurnCount=turns.length;lastChangeAt=now;
    }
    if(busy)lastChangeAt=now;
    const stable=now-lastChangeAt>=STABLE_MS;
    const loaded=document.readyState==='complete' && onChat();
    const draft=!!composerText(ed);
    const focused=!!ed && (document.activeElement===ed || ed.contains(document.activeElement));
    const prompt=permittedPrompt(lastU);
    // A positive completion witness must be attached to the current last assistant turn.
    const completed=completedActions(lastA);
    const approval=needsApproval(lastA) ||
      !!document.querySelector('[role="dialog"][aria-modal="true"]') ||
      [...document.querySelectorAll('button')].some(b=>visible(b) &&
        /^(continue generating|resume generation|המשך יצירה)$/iu.test(
          norm(b.getAttribute('aria-label')||b.textContent)));
    const ready=loaded && !!ed && !busy && !draft && !approval && stable && completed &&
      !!assistantText && lastRole==='assistant' && prompt.ok;
    let reason='';
    if(!loaded)reason='Waiting for page load';
    else if(!ed)reason='Ask ChatGPT composer not found';
    else if(busy)reason='ChatGPT is still generating; skipping';
    else if(approval)reason='Manual approval required; skipping';
    else if(draft)reason='Composer contains a draft; skipping';
    else if(lastRole!=='assistant'||!assistantText)reason='Waiting for assistant reply; skipping';
    else if(!completed)reason='No positive evidence the response completed; skipping';
    else if(!prompt.ok)reason=prompt.reason;
    else if(!stable)reason='Waiting for completed response to stabilize';
    return {conversation:onChat(),conversationId:location.pathname,loaded,hasComposer:!!ed,
      busy,completed,stable,hasDraft:draft,focused,requiresAction:approval,ready,reason,
      assistantSig,userCount:users.length,lastRole,
      lastUserSig:lastU?fingerprint(userText(lastU)):'',
      allowedPromptSig:prompt.ok?fingerprint(prompt.text):''};
  }
  function consistent(s,e){return s.conversationId===e?.conversationId &&
    s.assistantSig===e?.assistantSig && s.userCount===e?.userCount &&
    s.lastUserSig===e?.lastUserSig;}
  function prepare(expected){
    const s=inspect();
    if(!s.ready || !consistent(s,expected))return {ok:false,reason:s.reason||'Conversation state changed'};
    const ed=composer(); ed.scrollIntoView({block:'nearest',inline:'nearest'});
    const r=ed.getBoundingClientRect();
    if(r.width<10||r.height<10)return {ok:false,reason:'Composer is not visible'};
    const x=Math.max(2,Math.min(innerWidth-2,r.left+Math.min(45,r.width/2)));
    const y=Math.max(2,Math.min(innerHeight-2,r.top+r.height/2));
    const atPoint=document.elementFromPoint(x,y);
    if(x<r.left||x>r.right||y<r.top||y>r.bottom ||
       !(atPoint===ed||ed.contains(atPoint)))
      return {ok:false,reason:'Click target is not inside Ask ChatGPT'};
    return {ok:true,x,y};
  }
  function afterClick(expected){
    const s=inspect();
    return {ok:s.ready && s.focused && consistent(s,expected),
      reason:!s.focused?'Click did not focus Ask ChatGPT':s.reason||'Conversation state changed'};
  }
  function afterUp(expected){
    const s=inspect(), value=composerText(composer()), valueSig=fingerprint(value);
    const ok=s.loaded && s.focused && enabledSendControl() && !s.busy && s.completed && !s.requiresAction &&
      s.hasComposer && consistent(s,expected) && !!value &&
      valueSig===expected.lastUserSig && valueSig===s.allowedPromptSig;
    return {ok,editorEmpty:!value,reason:s.busy?'ChatGPT resumed generation; skip Enter':
      !s.completed?'Completion evidence disappeared; skip Enter':
      !enabledSendControl()?'Send control not enabled; skip Enter':
      !s.focused?'ArrowUp lost composer focus; skip Enter':
      !value?'ArrowUp did not recall a message':
      !consistent(s,expected)?'Conversation changed during input':
      'Recalled text differs from last user message; no Enter'};
  }
  function beforeEnter(expected){
    const r=afterUp(expected);
    if(!r.ok)return r;
    const s=inspect();
    return {ok:s.completed && !s.busy && enabledSendControl() && s.focused && s.hasDraft && consistent(s,expected),
      reason:'Pre-Enter safety check failed'};
  }
  function notify(){
    if(!monitoring)return;
    const s=inspect();
    const marker=[s.conversationId,s.ready,s.busy,s.completed,s.reason,s.assistantSig,
      s.userCount,s.lastUserSig,s.hasDraft,s.focused].join('|');
    if(marker===lastAnnouncement)return;
    lastAnnouncement=marker;
    chrome.runtime.sendMessage({type:'AP5_WAKE'}).catch(()=>{});
  }
  chrome.runtime.onMessage.addListener((m,sender,reply)=>{
    if(typeof m?.type!=='string')return;
    switch(m.type){
      case 'AP5_MONITOR':monitoring=!!m.enabled;lastAnnouncement='';reply({ok:true});
        if(monitoring)queueMicrotask(notify);break;
      case 'AP5_INSPECT':reply(inspect());break;
      case 'AP5_PREPARE':reply(prepare(m.expected));break;
      case 'AP5_AFTER_CLICK':reply(afterClick(m.expected));break;
      case 'AP5_AFTER_UP':reply(afterUp(m.expected));break;
      case 'AP5_BEFORE_ENTER':reply(beforeEnter(m.expected));break;
    }
  });
  const observer=new MutationObserver(()=>{
    if(!monitoring||notifyTimer)return;
    notifyTimer=setTimeout(()=>{notifyTimer=null;notify();},220);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,
    attributes:true,attributeFilter:['aria-label','disabled','data-state','aria-busy','data-testid']});
  setInterval(()=>{
    if(!monitoring)return;
    notify();chrome.runtime.sendMessage({type:'AP5_TICK'}).catch(()=>{});
  },PULSE_MS);
  chrome.runtime.sendMessage({type:'AP5_HELLO'}).then(r=>{
    monitoring=!!r?.monitored;if(monitoring)notify();
  }).catch(()=>{});
})();
