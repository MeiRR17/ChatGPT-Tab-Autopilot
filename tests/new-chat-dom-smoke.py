"""Synthetic Playwright/Chrome CDP test: old chat -> New Chat -> verified handoff -> Enter.
No ChatGPT account, cookies, or production messaging are involved.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML='''<!doctype html><html><head><meta charset="utf-8"></head><body>
<button data-testid="new-chat-button" id="new-chat">New chat</button>
<main data-app-shell-main-surface="browser">
<div id="timeline" data-app-action-timeline-scroll role="region">
 <div data-turn-key="t-last">
  <div data-content-search-unit-key="t-last:0:user"><div data-user-message-bubble="true">תמשיך את הפיתוח</div></div>
  <div data-content-search-unit-key="t-last:0:assistant" data-chatgpt-search-message-ids="answer-id">
   <div data-markdown-text-style="assistant-message">The extension source has 55 verified regression tests. Preserve reliable completion checks.</div></div>
  <div class="turn-action-controls"><button type="button" aria-label="Copy">Copy</button></div>
 </div>
</div></main>
<form data-chatgpt-composer onsubmit="return false">
 <div class="ProseMirror" role="textbox" data-composer-markdown contenteditable="true" id="editor" aria-label="Ask ChatGPT"
 style="width:650px;height:100px;border:1px solid #333"></div>
 <button type="button" id="send" data-testid="send-button" aria-label="Send message" disabled>Send</button>
</form>
<script>
window.__testPath='/c/old';window.oldUps=0;window.newEnters=0;window.newChatClicks=0;
const editor=document.getElementById('editor'),send=document.getElementById('send');
editor.addEventListener('input',()=>{send.disabled=!editor.innerText.trim();});
editor.addEventListener('keydown',e=>{
 if(e.key==='ArrowUp'&&window.__testPath==='/c/old'&&!editor.innerText.trim()){
  e.preventDefault();window.oldUps++;editor.textContent='תמשיך את הפיתוח';send.disabled=false;
 }
 if(e.key==='Enter' && window.__testPath==='/' && editor.innerText.trim()){
  e.preventDefault();window.newEnters++;const value=editor.innerText;
  window.__testPath='/c/fresh';
  const user=document.createElement('div');user.setAttribute('data-content-search-unit-key','t-new:0:user');
  const bubble=document.createElement('div');bubble.setAttribute('data-user-message-bubble','true');
  bubble.innerText=value;user.append(bubble);document.getElementById('timeline').append(user);
  editor.textContent='';send.disabled=true;
 }
});
document.getElementById('new-chat').addEventListener('click',()=>{
 window.newChatClicks++;window.__testPath='/';
 document.getElementById('timeline').replaceChildren();editor.textContent='';send.disabled=true;
});
</script>
</body></html>'''
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  try:
   context=await browser.new_context();page=await context.new_page()
   await page.set_content(HTML)
   await page.evaluate('''() => {window.chrome={runtime:{onMessage:{addListener:f=>window.__ask=f},sendMessage:async()=>({monitored:false})}}}''')
   source=(ROOT/'content.js').read_text()
   from_text=r"const onChat = () => /^\/(?:g\/[^/]+\/)?c\/[^/]+/.test(location.pathname);"
   to_text=r"const onChat = () => /^\/(?:g\/[^/]+\/)?c\/[^/]+/.test(window.__testPath);"
   assert from_text in source
   source=source.replace(from_text,to_text)
   source=source.replace('location.pathname','window.__testPath')
   await page.add_script_tag(content=source)
   async def ask(kind,**extra):
    return await page.evaluate('''msg=>new Promise(resolve=>window.__ask(msg,{},resolve))''',{'type':kind,**extra})
   await ask('AP5_INSPECT')
   await page.wait_for_timeout(5200)
   obs=await ask('AP5_INSPECT');assert obs['ready'],obs
   exp={key:obs[key] for key in ('conversationId','assistantSig','userCount','lastUserSig','lastUserId')}
   cdp=await context.new_cdp_session(page)
   async def click(point):
    for typ,other in [('mouseMoved',{}),('mousePressed',{'button':'left','clickCount':1}),('mouseReleased',{'button':'left','clickCount':1})]:
     await cdp.send('Input.dispatchMouseEvent',{'type':typ,'x':point['x'],'y':point['y'],**other})
   async def key(k,code,vk,mod=0):
    for typ in ('keyDown','keyUp'):
     await cdp.send('Input.dispatchKeyEvent',{'type':typ,'key':k,'code':code,'windowsVirtualKeyCode':vk,'nativeVirtualKeyCode':vk,'modifiers':mod})
   prep=await ask('AP5_PREPARE',expected=exp);assert prep['ok'],prep
   await click(prep)
   assert (await ask('AP5_AFTER_CLICK',expected=exp))['ok']
   await key('ArrowUp','ArrowUp',38)
   after=await ask('AP5_AFTER_UP',expected=exp);assert after['ok'],after
   captured=await ask('AP5_ROLLOVER_CAPTURE',expected=exp);assert captured['ok'],captured
   assert captured['prompt']=='תמשיך את הפיתוח'
   assert '55 verified' in captured['assistantExcerpt']
   # Only clean a provably recalled input.
   assert (await ask('AP5_CLEANUP_CHECK',expected=exp))['ok']
   await page.locator('#editor').press('ControlOrMeta+A');await key('Backspace','Backspace',8)
   assert not (await ask('AP5_INSPECT'))['hasDraft']
   nc=await ask('AP5_FIND_NEW_CHAT');assert nc['ok'],nc
   await click(nc); assert (await page.evaluate('window.__testPath'))=='/'
   next_editor=await ask('AP5_NEW_CHAT_PREPARE');assert next_editor['ok'],next_editor
   await click(next_editor); assert (await ask('AP5_NEW_CHAT_FOCUSED'))['ok']
   seed='Carry forward context: '+captured['assistantExcerpt']+'\n\nLast request: '+captured['prompt']
   await cdp.send('Input.insertText',{'text':seed})
   check=await ask('AP5_NEW_CHAT_VERIFY',expectedText=seed)
   assert check['ok'],(check,await page.locator('#editor').inner_text())
   await key('Enter','Enter',13)
   assert (await ask('AP5_INSPECT'))['lastUserSemanticSig']==check['seedSig']
   counters=await page.evaluate('''() => ({oldUps,newChatClicks,newEnters,path:window.__testPath})''')
   assert counters=={'oldUps':1,'newChatClicks':1,'newEnters':1,'path':'/c/fresh'},counters
   print('NEW_CHAT_CDP_SMOKE_PASS',counters,'fingerprint',check['seedSig'])
  finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
