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
  const semanticFingerprint = value => fingerprint(norm(value).replace(/\s+/gu,' '));
  const onChat = () => /^\/(?:g\/[^/]+\/)?c\/[^/]+/.test(location.pathname);
  const visible = el => !!el && el.isConnected && el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  // Modern ChatGPT uses a ProseMirror editor rather than #prompt-textarea.
  // Keep the composer scoped to a ChatGPT form; never focus an unrelated editor.
  const composerSelectors = [
    'form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"][role="textbox"]',
    'form [data-composer-markdown][contenteditable="true"]',
    '#prompt-textarea[contenteditable="true"]',
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
  // The October 2026 app shell groups the user and assistant into a single
  // [data-turn-key] container and uses :user / :assistant search units. Legacy
  // article/section turn wrappers are retained on older accounts.
  let detectedLayout='none';
  function getTurns() {
    const timeline=document.querySelector('[data-app-action-timeline-scroll][role="region"]') ||
      document.querySelector('[data-app-action-timeline-scroll]');
    const modernRoot=timeline || document;
    const modern=[...modernRoot.querySelectorAll(
      '[data-content-search-unit-key$=":user"], [data-content-search-unit-key$=":assistant"]')]
      .filter(visible).filter(node => !node.parentElement?.closest('[data-content-search-unit-key]'));
    if(modern.length){detectedLayout='app-shell';return modern;}
    // Do not accidentally stop at a selection containing *only* user turns
    // when another selector can see both message roles.
    const candidates=[
      'article[data-turn="user"],article[data-turn="assistant"],section[data-turn="user"],section[data-turn="assistant"]',
      '[data-testid^="conversation-turn-"][data-turn="user"], [data-testid^="conversation-turn-"][data-turn="assistant"]',
      '[data-message-author-role="user"], [data-message-author-role="assistant"]'
    ];
    let best=[];
    for(const selector of candidates){
      const nodes=[...document.querySelectorAll(selector)].filter(visible);
      if(nodes.some(n=>role(n)==='user') && nodes.some(n=>role(n)==='assistant')){
        detectedLayout='classic';return nodes;
      }
      if(nodes.length>best.length)best=nodes;
    }
    detectedLayout=best.length?'partial-legacy':'unknown';
    return best;
  }
  function role(turn) {
    const direct=turn?.getAttribute('data-turn') || turn?.getAttribute('data-message-author-role');
    if(direct==='user'||direct==='assistant')return direct;
    const key=turn?.getAttribute('data-content-search-unit-key')||'';
    if(key.endsWith(':user'))return 'user';
    if(key.endsWith(':assistant'))return 'assistant';
    return '';
  }
  function userText(turn) {
    if(!turn)return '';
    const bubble=turn.matches?.('[data-user-message-bubble]') ? turn :
      turn.querySelector('[data-user-message-bubble]');
    if(bubble)return norm(bubble.innerText||bubble.textContent);
    const blocks=[...turn.querySelectorAll('[data-testid="user-message"],.whitespace-pre-wrap')];
    const top=blocks.filter(n => !blocks.some(other => other!==n && other.contains(n)));
    return norm(top.length ? top.map(n=>n.innerText||'').join('\n') : turn.innerText||'');
  }
  function assistantText(turn){
    if(!turn)return '';
    const contents=[...turn.querySelectorAll(
      '[data-markdown-text-style="assistant-message"],.markdown,.prose')]
      .filter(node=>!node.parentElement?.closest('[data-markdown-text-style="assistant-message"],.markdown,.prose'));
    return norm(contents.length?contents.map(node=>node.innerText||node.textContent||'').join('\n'):
      turn.innerText||turn.textContent||'');
  }
  function turnId(turn){
    if(!turn)return '';
    return turn.closest('[data-turn-key]')?.getAttribute('data-turn-key') ||
      turn.getAttribute('data-message-id') ||
      turn.getAttribute('data-chatgpt-search-message-ids') ||
      turn.getAttribute('data-turn-id') || '';
  }
  function permittedPrompt(turn) {
    const text=userText(turn);
    if (!text || text.length>500 || text.includes('\n\n'))
      return {ok:false,reason:'The last user message is not a short continuation request'};
    if (!/^(?:תמשיך|המשך|אני רוצה שתמשיך|בבקשה תמשיך|אפשר להמשיך|continue\b|keep going\b|please continue\b)/iu.test(text))
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
    const wrapper=lastAssistant.closest('[data-turn-key],article[data-turn],section[data-turn],[data-testid^="conversation-turn-"]') || lastAssistant;
    const actionSelectors=['button[data-testid="copy-turn-action-button"]',
      '.turn-action-controls button'];
    // A user-message copy button in the same modern turn is NOT evidence that
    // its assistant response finished. Require a control at/after the assistant.
    return actionSelectors.some(sel=>[...wrapper.querySelectorAll(sel)].some(button=>
      visible(button) && (lastAssistant.contains(button) ||
      !!(lastAssistant.compareDocumentPosition(button)&Node.DOCUMENT_POSITION_FOLLOWING))));
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
    const textOfAssistant=assistantText(lastA);
    const assistantIdentity=lastA?.getAttribute('data-chatgpt-search-message-ids') || turnId(lastA);
    // Stable identity protects against virtualized turn counts and identical
    // text produced in separate responses.
    const assistantSig=lastA ? `${assistantIdentity||assistants.length}:${fingerprint(textOfAssistant)}` : '';
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
    const lastUserId=turnId(lastU);
    const diagnostics={layout:detectedLayout,visibleUsers:users.length,
      visibleAssistants:assistants.length,composerFound:!!ed,
      hasCompletionAction:false};
    // A positive completion witness must be attached to the current last assistant turn.
    const completed=completedActions(lastA);
    diagnostics.hasCompletionAction=completed;
    const approval=needsApproval(lastA) ||
      !!document.querySelector('[role="dialog"][aria-modal="true"]') ||
      [...document.querySelectorAll('button')].some(b=>visible(b) &&
        /^(continue generating|resume generation|המשך יצירה)$/iu.test(
          norm(b.getAttribute('aria-label')||b.textContent)));
    const ready=loaded && !!ed && !busy && !draft && !approval && stable && completed &&
      !!textOfAssistant && lastRole==='assistant' && prompt.ok;
    let reason='';
    if(!loaded)reason='Waiting for page load';
    else if(!ed)reason='Ask ChatGPT composer not found';
    else if(busy)reason='ChatGPT is still generating; skipping';
    else if(approval)reason='Manual approval required; skipping';
    else if(draft)reason='Composer contains a draft; skipping';
    else if(lastRole!=='assistant'||!textOfAssistant)reason=`Assistant reply not visible in DOM (layout=${detectedLayout}, user=${users.length}, assistant=${assistants.length}); skipping`;
    else if(!completed)reason='No positive evidence the response completed; skipping';
    else if(!prompt.ok)reason=prompt.reason;
    else if(!stable)reason='Waiting for completed response to stabilize';
    return {conversation:onChat(),conversationId:location.pathname,loaded,hasComposer:!!ed,
      busy,completed,stable,hasDraft:draft,focused,requiresAction:approval,ready,reason,
      assistantSig,userCount:users.length,lastRole,lastUserId,diagnostics,
      lastUserSig:lastU?fingerprint(userText(lastU)):'',
      lastUserSemanticSig:lastU?semanticFingerprint(userText(lastU)):'',
      allowedPromptSig:prompt.ok?fingerprint(prompt.text):''};
  }
  function consistent(s,e){return s.conversationId===e?.conversationId &&
    s.assistantSig===e?.assistantSig && s.userCount===e?.userCount &&
    s.lastUserSig===e?.lastUserSig &&
    (!e?.lastUserId || s.lastUserId===e.lastUserId);}
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
    const s=inspect(), ed=composer(), value=composerText(ed);
    const lastUser=getTurns().filter(n=>role(n)==='user').at(-1);
    const expectedText=permittedPrompt(lastUser);
    // ProseMirror may turn CRLF, NBSP, and wrapping into different raw text.
    // Compare the actual words, not unrelated messages or untrusted drafts.
    const normalized=value=>norm(value).replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\n{2,}/g,'\n');
    const sameText=expectedText.ok && !!value &&
      normalized(value)===normalized(expectedText.text);
    const sendEnabled=enabledSendControl(), sameTurn=consistent(s,expected);
    const ok=s.loaded && s.focused && sendEnabled && !s.busy && s.completed &&
      !s.requiresAction && s.hasComposer && sameTurn && sameText;
    let reason='';
    if(!s.loaded)reason='ChatGPT page not fully loaded';
    else if(s.busy)reason='Assistant resumed generation';
    else if(s.requiresAction)reason='Approval or dialog is blocking input';
    else if(!s.completed)reason='Assistant completion evidence disappeared';
    else if(!s.focused)reason='Composer focus lost after ArrowUp';
    else if(!sameTurn)reason='Conversation changed during ArrowUp';
    else if(!value)reason='ArrowUp did not restore text in the composer';
    else if(!sameText)reason='Restored text differs from the last continuation message';
    else if(!sendEnabled)reason='Send control is not enabled after ArrowUp';
    return {ok,editorEmpty:!value,reason};
  }
  function beforeEnter(expected){
    const r=afterUp(expected);
    if(!r.ok)return r;
    const s=inspect();
    return {ok:s.completed && !s.busy && enabledSendControl() && s.focused && s.hasDraft && consistent(s,expected),
      reason:'Pre-Enter safety check failed'};
  }
  function rolloverCapture(expected){
    const s=inspect();const ed=composer(),value=composerText(ed);
    if(!s.completed || s.busy || !s.focused || !consistent(s,expected) ||
       !value || fingerprint(value)!==expected.lastUserSig ||
       value!==permittedPrompt(getTurns().filter(n=>role(n)==='user').at(-1)).text)
      return {ok:false,reason:'Unverified last user prompt; refusing contextless rollover'};
    const lastAssistant=getTurns().filter(n=>role(n)==='assistant').at(-1);
    const excerpt=assistantText(lastAssistant).slice(-7000);
    if(!excerpt)return {ok:false,reason:'Latest assistant reply unavailable'};
    // Only in message response, never in local storage or exported logs.
    return {ok:true,prompt:value,assistantExcerpt:excerpt};
  }
  function findNewChat(){
    const selectors=['[data-testid="new-chat-button"]','a[aria-label="New chat"]',
      'button[aria-label="New chat"]','a[title="New chat"]',
      'a[href="/"][data-testid*="new-chat"]','button[data-testid*="new-chat"]'];
    const candidates=[];
    for(const sel of selectors)candidates.push(...document.querySelectorAll(sel));
    candidates.push(...[...document.querySelectorAll('a,button')].filter(el=>
      /^(new chat|new conversation|צ[׳']אט חדש|שיחה חדשה|צור שיחה חדשה)$/iu.test(
        norm(el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent))));
    for(const el of candidates){
      if(!visible(el))continue;
      const r=el.getBoundingClientRect();
      if(r.width<8||r.height<8)continue;
      const x=r.left+r.width/2,y=r.top+r.height/2;
      const at=document.elementFromPoint(x,y);
      if(x<1||x>innerWidth-1||y<1||y>innerHeight-1||
         !(at===el||el.contains(at)))continue;
      return {ok:true,x,y};
    }
    return {ok:false,reason:'Visible New Chat button not found in current UI'};
  }
  function newChatPrepare(){
    if(onChat())return {ok:false,reason:'Still in old conversation'};
    if(document.readyState!=='complete'||generationActive())
      return {ok:false,reason:'New Chat still loading'};
    const ed=composer();if(!ed||composerText(ed)||
       document.querySelector('[role="dialog"][aria-modal="true"]'))
      return {ok:false,reason:'New Chat editor not ready/empty'};
    const r=ed.getBoundingClientRect();
    const x=r.left+Math.min(40,r.width/2),y=r.top+r.height/2;
    const at=document.elementFromPoint(x,y);
    if(r.width<20||r.height<15||!at||!(at===ed||ed.contains(at)))
      return {ok:false,reason:'New Chat composer click position invalid'};
    return {ok:true,x,y};
  }
  function newChatFocused(){
    const ed=composer();return {ok:!!ed&&!onChat()&&!composerText(ed)&&
      (document.activeElement===ed||ed.contains(document.activeElement))};
  }
  function newChatVerify(expectedText){
    const ed=composer(),value=composerText(ed);
    // ProseMirror can render blank paragraphs as additional line breaks.
    const equivalent=(a,b)=>norm(a).replace(/\n{2,}/g,'\n\n')===norm(b).replace(/\n{2,}/g,'\n\n');
    const ok=!onChat() && !!ed &&
      (document.activeElement===ed||ed.contains(document.activeElement)) &&
      !generationActive() && !document.querySelector('[role="dialog"][aria-modal="true"]') &&
      equivalent(value,expectedText) && enabledSendControl();
    return {ok,seedSig:ok?semanticFingerprint(value):'',reason:ok?'':'New-chat text, focus, Send button or generation state changed'};
  }
  // First reply after a context handoff is followed by one short user message.
  // ArrowUp would otherwise recall the entire 7k context seed on every turn.
  const HANDOFF_PREFIX='This is a NEW ChatGPT conversation continuing previous project work.';
  function bootstrapState(expected){
    const s=inspect();
    const lastU=getTurns().filter(n=>role(n)==='user').at(-1);
    const isHandoff=userText(lastU).startsWith(HANDOFF_PREFIX);
    return {s,ok:s.loaded && s.stable && s.completed && !s.busy &&
      !s.requiresAction && s.lastRole==='assistant' && s.hasComposer &&
      isHandoff && consistent(s,expected)};
  }
  function bootstrapPrepare(expected){
    const b=bootstrapState(expected),ed=composer();
    if(!b.ok||!ed||composerText(ed))return {ok:false,reason:'Bootstrap reply not finished or composer not empty'};
    ed.scrollIntoView({block:'nearest',inline:'nearest'});
    const r=ed.getBoundingClientRect();
    const x=r.left+Math.min(45,r.width/2),y=r.top+r.height/2;
    const at=document.elementFromPoint(x,y);
    if(r.width<20||r.height<15||!(at===ed||ed.contains(at)))return {ok:false,reason:'Bootstrap click target invalid'};
    return {ok:true,x,y};
  }
  function bootstrapFocused(expected){
    const b=bootstrapState(expected),ed=composer();
    return {ok:b.ok && !composerText(ed) &&
      (document.activeElement===ed||ed?.contains(document.activeElement))};
  }
  function bootstrapVerify(expected,prompt){
    const b=bootstrapState(expected),ed=composer(),value=composerText(ed);
    const ok=b.ok && !!ed && value===norm(prompt) &&
      (document.activeElement===ed||ed.contains(document.activeElement)) &&
      enabledSendControl();
    return {ok,promptSig:ok?fingerprint(value):'',reason:ok?'':'Bootstrap text, focus or Send control changed'};
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
      case 'AP5_ROLLOVER_CAPTURE':reply(rolloverCapture(m.expected));break;
      case 'AP5_FIND_NEW_CHAT':reply(findNewChat());break;
      case 'AP5_NEW_CHAT_PREPARE':reply(newChatPrepare());break;
      case 'AP5_NEW_CHAT_FOCUSED':reply(newChatFocused());break;
      case 'AP5_NEW_CHAT_VERIFY':reply(newChatVerify(m.expectedText));break;
      case 'AP5_BOOTSTRAP_PREPARE':reply(bootstrapPrepare(m.expected));break;
      case 'AP5_BOOTSTRAP_FOCUSED':reply(bootstrapFocused(m.expected));break;
      case 'AP5_BOOTSTRAP_VERIFY':reply(bootstrapVerify(m.expected,m.prompt));break;
    }
  });
  const observer=new MutationObserver(()=>{
    if(!monitoring||notifyTimer)return;
    notifyTimer=setTimeout(()=>{notifyTimer=null;notify();},220);
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,
    attributes:true,attributeFilter:['aria-label','disabled','data-state','aria-busy','data-testid','data-turn-key',
      'data-content-search-unit-key','data-user-message-bubble','data-composer-markdown']});
  setInterval(()=>{
    if(!monitoring)return;
    notify();chrome.runtime.sendMessage({type:'AP5_TICK'}).catch(()=>{});
  },PULSE_MS);
  chrome.runtime.sendMessage({type:'AP5_HELLO'}).then(r=>{
    monitoring=!!r?.monitored;if(monitoring)notify();
  }).catch(()=>{});
})();
