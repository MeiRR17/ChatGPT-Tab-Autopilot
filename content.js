'use strict';
(() => {
  const composer = () => document.querySelector('#prompt-textarea, [data-testid="prompt-textarea"], div[contenteditable="true"][role="textbox"]');
  const text = el => (el?.innerText || el?.textContent || '').trim();
  const sig = s => { let h=2166136261; for(const c of String(s||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(16); };
  const messages = role => [...document.querySelectorAll('[data-message-author-role="'+role+'"]')];
  const last = list => list[list.length-1];
  const isVisible = el => !!el && !!(el.getClientRects().length);
  const busyLabels = /stop generating|stop response|stop streaming|עצור יצירה|הפסק יצירה|cancel response/i;
  const actionable = /approve|confirm|allow|run tool|אישור|אשר|הרשה/i;
  function inspect() {
    const input=composer(), as=messages('assistant'), us=messages('user'), final=last(as);
    const buttons=[...document.querySelectorAll('button')].filter(isVisible);
    const busy=buttons.some(b=>busyLabels.test([b.getAttribute('aria-label'),b.title,b.getAttribute('data-testid'),text(b)].join(' ')));
    const dialog=!!document.querySelector('[role="dialog"], [aria-modal="true"]') ||
      buttons.some(b=>actionable.test([b.getAttribute('aria-label'),b.getAttribute('data-testid')].join(' ')));
    // Require completion evidence scoped to the last assistant message; mere inactivity never counts.
    const replyActions=final && [...final.querySelectorAll('button')].some(b=>
      /copy|clipboard|העתק/.test([b.getAttribute('data-testid'),b.getAttribute('aria-label'),b.title].join(' ').toLowerCase()));
    const rect=input?.getBoundingClientRect();
    const prompt=text(last(us));
    const url=new URL(location.href);
    const valid=/^\/(c\/|g\/[^/]+\/c\/)/.test(url.pathname);
    const draft=text(input);
    return {
      loaded:document.readyState==='complete', conversation:valid, conversationId:url.pathname,
      composer:!!input && !!rect && rect.width>0 && rect.height>0 && isVisible(input),
      rect:rect?{x:Math.round(rect.left+Math.min(rect.width/2,100)),y:Math.round(rect.top+rect.height/2)}:null,
      busy, dialog, draft:!!draft, composerText:draft, complete:!!replyActions && !busy,
      ready:!!final && final===last([...document.querySelectorAll('[data-message-author-role]')]) && !!replyActions && !busy && !dialog,
      users:us.length, lastUser:sig(prompt), assistant:sig(text(final)),
      prompt:prompt.length<=200?prompt:''
    };
  }
  chrome.runtime.onMessage.addListener((msg,_sender,send) => {
    if(msg?.type==='INSPECT'){send(inspect());return;}
    if(msg?.type==='PING'){send({ok:true});return;}
  });
  let lastNotify=0;
  new MutationObserver(() => {
    const now=Date.now(); if(now-lastNotify<1000)return;
    lastNotify=now; chrome.runtime.sendMessage({type:'DOM_CHANGED'}).catch(()=>{});
  }).observe(document.documentElement,{childList:true,subtree:true,attributes:true,characterData:true});
  window.addEventListener('load',()=>chrome.runtime.sendMessage({type:'DOM_CHANGED'}).catch(()=>{}));
})();
