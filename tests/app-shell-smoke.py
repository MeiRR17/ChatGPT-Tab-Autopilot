"""Synthetic Chrome app-shell DOM regression: no logged-in ChatGPT content."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
USER='תמשיך את הפיתוח'
HTML=f'''<!doctype html><html><head><meta charset="utf-8"></head><body>
<main data-app-shell-main-surface="browser">
 <div data-app-action-timeline-scroll role="region" style="height:360px;overflow:auto">
  <div data-turn-key="turn-previous">
   <div data-content-search-unit-key="turn-previous:0:user"><div data-user-message-bubble="true">A past question?</div></div>
   <div data-content-search-unit-key="turn-previous:0:assistant"><div data-markdown-text-style="assistant-message">Earlier answer.</div></div>
   <div class="turn-action-controls"><button aria-label="Copy">Copy</button></div>
  </div>
  <div data-turn-key="turn-current">
   <div data-content-search-unit-key="turn-current:0:user"><div data-user-message-bubble="true">{USER}</div></div>
   <div data-content-search-unit-key="turn-current:0:assistant" data-chatgpt-search-message-ids="answer-last">
    <div data-markdown-text-style="assistant-message">Long task completed successfully.</div></div>
   <div class="turn-action-controls"><button aria-label="Copy">Copy</button></div>
  </div>
 </div>
</main>
<form data-chatgpt-composer onsubmit="return false">
  <div class="ProseMirror" role="textbox" data-composer-markdown contenteditable="true"
    aria-label="Ask ChatGPT" id="editor" style="width:550px;height:70px;border:1px solid gray"></div>
  <button type="button" data-testid="send-button" id="send" aria-label="Send message" disabled>Send</button>
  <button type="button" data-testid="stop-button" id="stop" style="display:none">Stop</button>
</form>
<script>
window.clicks=0;window.ups=0;window.enters=0;
const editor=document.querySelector('#editor');
editor.addEventListener('click',()=>{{window.clicks++}});
editor.addEventListener('keydown',e=>{{
 if(e.key==='ArrowUp' && !editor.innerText.trim()){{e.preventDefault();window.ups++;
 editor.textContent={USER!r};document.querySelector('#send').disabled=false;}}
 if(e.key==='Enter' && editor.innerText.trim()){{e.preventDefault();window.enters++;
 editor.textContent='';document.querySelector('#send').disabled=true;}}
}});
</script>
</body></html>'''
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  try:
   context=await browser.new_context();page=await context.new_page()
   await page.set_content(HTML)
   await page.evaluate('''() => {window.chrome={runtime:{onMessage:{addListener:f=>window.__ask=f},
     sendMessage:async()=>({monitored:false})}};}''')
   source=(ROOT/'content.js').read_text()
   source=source.replace('const onChat = () => /^\\/(?:g\\/[^/]+\\/)?c\\/[^/]+/.test(location.pathname);',
       'const onChat = () => true;')
   assert 'const onChat = () => true;' in source
   await page.add_script_tag(content=source)
   async def ask(typ, expected=None):
    return await page.evaluate('''m=>new Promise(res=>window.__ask(m,{},res))''',
      {'type':typ,**({'expected':expected} if expected else {})})
   s=await ask('AP5_INSPECT')
   assert s['lastRole']=='assistant',s
   assert s['diagnostics']['layout']=='app-shell',s
   assert not s['ready'] and not s['stable'],s
   await page.wait_for_timeout(5300)
   s=await ask('AP5_INSPECT')
   assert s['ready'] and s['completed'] and not s['busy'],s
   assert s['lastUserId']=='turn-current',s
   expected={k:s[k] for k in ('conversationId','assistantSig','userCount','lastUserSig','lastUserId')}
   r=await ask('AP5_PREPARE',expected);assert r['ok'],r
   cdp=await context.new_cdp_session(page)
   for typ,extra in [('mouseMoved',{}),('mousePressed',{'button':'left','clickCount':1}),('mouseReleased',{'button':'left','clickCount':1})]:
    await cdp.send('Input.dispatchMouseEvent',{'type':typ,'x':r['x'],'y':r['y'],**extra})
   assert (await ask('AP5_AFTER_CLICK',expected))['ok']
   key={'key':'ArrowUp','code':'ArrowUp','windowsVirtualKeyCode':38,'nativeVirtualKeyCode':38}
   for typ in ('keyDown','keyUp'): await cdp.send('Input.dispatchKeyEvent',{'type':typ,**key})
   up=await ask('AP5_AFTER_UP',expected);assert up['ok'],up
   gate=await ask('AP5_BEFORE_ENTER',expected);assert gate['ok'],gate
   enter={'key':'Enter','code':'Enter','windowsVirtualKeyCode':13,'nativeVirtualKeyCode':13,
      'text':'\r','unmodifiedText':'\r'}
   await cdp.send('Input.dispatchKeyEvent',{'type':'keyDown',**enter})
   await cdp.send('Input.dispatchKeyEvent',{**enter,'type':'keyUp'})
   counts=await page.evaluate('()=>({clicks,ups,enters})')
   assert counts=={'clicks':1,'ups':1,'enters':1},counts
   await page.locator('#stop').evaluate("el=>el.style.display='block'")
   assert (await ask('AP5_INSPECT'))['busy']
   print('APP_SHELL_CDP_SMOKE_PASS',counts)
  finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
