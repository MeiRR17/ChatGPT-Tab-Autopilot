"""Chromium test of exact mouse / ArrowUp / Enter using Chrome CDP (mock HTML, no live ChatGPT)."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML='''<!doctype html><html><body><main id="hist">
<article data-message-author-role="user"><div class="whitespace-pre-wrap">תמשיך את הפיתוח</div></article>
<article data-message-author-role="assistant">התשובה הסתיימה<button data-testid="copy-turn-action-button" type="button">Copy</button></article></main>
<form onsubmit="return false"><div id="prompt-textarea" role="textbox" contenteditable="true" style="height:60px;width:400px;border:2px solid black"></div>
<button type="button" data-testid="send-button" aria-label="Send message" id="send-button" disabled>Send</button>
<button type="button" id="stop" data-testid="stop-button" style="display:none">Stop generating</button></form>
<script>
window.clicks=0;window.ups=0;window.enters=0;
const ed=document.querySelector('#prompt-textarea');
ed.addEventListener('click',()=>clicks++);
ed.addEventListener('keydown',e=>{
if(e.key==='ArrowUp'&&!ed.innerText.trim()){e.preventDefault();ups++;ed.textContent='תמשיך את הפיתוח';document.querySelector('#send-button').disabled=false}
if(e.key==='Enter'&&ed.innerText.trim()){e.preventDefault();enters++;ed.textContent=''}
});
</script></body></html>'''
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
                                  args=['--no-sandbox','--disable-dev-shm-usage'])
  try:
   ctx=await browser.new_context();page=await ctx.new_page()
   await page.set_content(HTML)
   await page.evaluate('''() => {window.chrome={runtime:{onMessage:{addListener:fn=>window.__inspect=fn},
     sendMessage:async()=>({monitored:false})}};}''')
   source=(ROOT/'content.js').read_text().replace("const onChat = () => /^\\/(?:g\\/[^/]+\\/)?c\\/[^/]+/.test(location.pathname);","const onChat = () => true;")
   assert 'const onChat = () => true;' in source
   await page.add_script_tag(content=source)
   async def ask(typ,expected=None):
    return await page.evaluate('''m=>new Promise(res=>window.__inspect(m,{},res))''',
                               {'type':typ,**({'expected':expected} if expected else {})})
   await ask('AP5_INSPECT')
   await page.wait_for_timeout(5300)
   status=await ask('AP5_INSPECT')
   assert status['ready'],status
   expect={x:status[x] for x in ('conversationId','assistantSig','userCount','lastUserSig')}
   prepare=await ask('AP5_PREPARE',expect)
   assert prepare['ok'],prepare
   cdp=await ctx.new_cdp_session(page)
   x,y=prepare['x'],prepare['y']
   for t, extra in [('mouseMoved',{}),('mousePressed',{'button':'left','clickCount':1}),
                   ('mouseReleased',{'button':'left','clickCount':1})]:
    await cdp.send('Input.dispatchMouseEvent',{'type':t,'x':x,'y':y,**extra})
   assert (await ask('AP5_AFTER_CLICK',expect))['ok']
   keyprops={'key':'ArrowUp','code':'ArrowUp','windowsVirtualKeyCode':38,'nativeVirtualKeyCode':38}
   await cdp.send('Input.dispatchKeyEvent',{'type':'keyDown',**keyprops})
   await cdp.send('Input.dispatchKeyEvent',{'type':'keyUp',**keyprops})
   up=await ask('AP5_AFTER_UP',expect)
   assert up['ok'],up
   await cdp.send('Input.dispatchKeyEvent',{'type':'keyDown','key':'Enter','code':'Enter',
     'windowsVirtualKeyCode':13,'nativeVirtualKeyCode':13,'text':'\r','unmodifiedText':'\r'})
   await cdp.send('Input.dispatchKeyEvent',{'type':'keyUp','key':'Enter','code':'Enter',
     'windowsVirtualKeyCode':13,'nativeVirtualKeyCode':13})
   counts=await page.evaluate('()=>({clicks,ups,enters})')
   print('CDP click + ArrowUp + Enter:',counts)
   assert counts=={'clicks':1,'ups':1,'enters':1},counts
   await page.locator('#stop').evaluate("el=>el.style.display='block'")
   assert (await ask('AP5_INSPECT'))['busy']
   print('DOM_CDP_SMOKE_PASS')
  finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
