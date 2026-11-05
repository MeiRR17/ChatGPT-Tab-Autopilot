"""Install the real Manifest V3 extension in Playwright's bundled Chromium.
All ChatGPT pages are synthetic, intercepted locally; no account/network access.
Regression: busy tabs skip, ready tabs send after positive completion,
and duplicate tabs are not allowed to send the same conversation twice.
"""
import asyncio, json, tempfile, os, time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parents[1]
HTML = r'''<!doctype html><html><head><title>Mock ChatGPT</title></head><body>
<main id="history">
  <article data-message-author-role="user"><div class="whitespace-pre-wrap">תמשיך את הפיתוח</div></article>
  <article data-message-author-role="assistant">תשובה קודמת הסתיימה<button type="button" data-testid="copy-turn-action-button">Copy</button></article>
</main>
<form onsubmit="return false"><div id="prompt-textarea" role="textbox" contenteditable="true"
style="border:1px solid #777;padding:16px;min-height:35px;width:400px"></div>
<button id="send-button" data-testid="send-button" aria-label="Send message" type="button" disabled>Send</button>
<button id="stop" data-testid="stop-button" type="button" style="display:none">Stop generating</button></form>
<script>
const editor=document.querySelector('#prompt-textarea');
const history=document.querySelector('#history');
window.sends=0;window.overlaps=0;window.clicks=0;window.ups=0;window.busy=false;
editor.addEventListener('click',()=>{window.clicks++});
function setBusy(x){window.busy=x;document.querySelector('#stop').style.display=x?'block':'none'}
editor.addEventListener('keydown', e=>{
  if(e.key==='ArrowUp' && !editor.innerText.trim()){
    e.preventDefault();window.ups++;document.querySelector('#send-button').disabled=false;
    editor.textContent=[...document.querySelectorAll('[data-message-author-role=user] .whitespace-pre-wrap')].at(-1).textContent;
  }
  if(e.key==='Enter'){
    e.preventDefault();if(window.busy){window.overlaps++;return}
    const text=editor.innerText.trim();if(!text)return;
    window.sends++;editor.textContent='';document.querySelector('#send-button').disabled=true;
    const u=document.createElement('article');u.dataset.messageAuthorRole='user';
    const d=document.createElement('div');d.className='whitespace-pre-wrap';d.textContent=text;u.append(d);history.append(u);
    setBusy(true);
    setTimeout(()=>{
      const a=document.createElement('article');a.dataset.messageAuthorRole='assistant';
      a.textContent='תשובה מספר '+window.sends;const btn=document.createElement('button');btn.dataset.testid='copy-turn-action-button';btn.textContent='Copy';a.append(btn);history.append(a);setBusy(false);
    },3600);
  }
});
if(location.pathname.endsWith('/busy')){
  setBusy(true);
  setTimeout(()=>{
    const a=document.createElement('article');a.dataset.messageAuthorRole='assistant';
    a.textContent='תשובה התחלתית הסתיימה';const btn=document.createElement('button');btn.dataset.testid='copy-turn-action-button';btn.textContent='Copy';a.append(btn);history.append(a);setBusy(false);
  },10500);
}
</script></body></html>'''
async def main():
    async with async_playwright() as pw:
        with tempfile.TemporaryDirectory() as profile:
            # The system-installed Chromium in some environments has a mandatory
            # ExtensionInstallBlocklist. Use Playwright's bundled Chromium with
            # channel='chromium', per the official Manifest V3 testing guide.
            # An explicitly supplied executable is supported for local diagnostics.
            binary=os.getenv('AUTOPILOT_CHROMIUM')
            options={'headless':os.getenv('AUTOPILOT_HEADED')!='1',
                'args':[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}',
                        '--no-sandbox','--disable-gpu','--disable-dev-shm-usage']}
            if binary:
                options['executable_path']=binary
            else:
                options['channel']='chromium'
            ctx=await pw.chromium.launch_persistent_context(profile,**options)
            try:
                sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker',timeout=20000)
                eid=sw.url.split('/')[2]
                await ctx.route('https://chatgpt.com/c/**',lambda route:route.fulfill(
                    status=200,content_type='text/html; charset=utf-8',body=HTML))
                busy=await ctx.new_page();await busy.goto('https://chatgpt.com/c/busy')
                good=await ctx.new_page();await good.goto('https://chatgpt.com/c/ready')
                duplicate=await ctx.new_page();await duplicate.goto('https://chatgpt.com/c/ready')
                await good.bring_to_front()
                report=await ctx.new_page();await report.goto(f'chrome-extension://{eid}/report.html')
                await good.bring_to_front()
                await report.evaluate("async()=>await chrome.runtime.sendMessage({type:'AP5_TOGGLE'})")
                await good.wait_for_timeout(8500)
                first=await good.evaluate("()=>({sends,clicks,ups,overlaps,busy})")
                other=await busy.evaluate("()=>({sends,clicks,ups,overlaps,busy})")
                shadow=await duplicate.evaluate("()=>({sends,clicks,ups,overlaps,busy})")
                print('at 8.5s ready tab:',first,'busy tab:',other,'duplicate:',shadow)
                assert first['sends']>=1, 'ready tab did not send'
                assert first['clicks']>=1 and first['ups']>=1, 'no real mouse/Up sequence'
                assert first['overlaps']==0
                assert other['sends']==0, 'busy tab incorrectly sent'
                assert shadow['sends']==0 and shadow['ups']==0, 'duplicate chat received keyboard input'
                await good.wait_for_timeout(10500)
                second=await busy.evaluate("()=>({sends,clicks,ups,overlaps,busy})")
                print('at ~19s previously busy tab:', second)
                assert second['sends']>=1, 'previously busy tab never resumed'
                assert second['overlaps']==0
                shadow=await duplicate.evaluate("()=>({sends,ups,overlaps})")
                assert shadow['sends']==0 and shadow['ups']==0, 'duplicate became active during monitoring'
                log=await report.evaluate("async()=>(await chrome.storage.local.get('autopilot5_logs')).autopilot5_logs||[]")
                state=await report.evaluate("async()=>(await chrome.storage.local.get('autopilot5_state')).autopilot5_state")
                print('last events:',json.dumps(log[-12:],ensure_ascii=False)[:2500])
                print('state:',json.dumps(state,ensure_ascii=False)[:1400])
                assert any(e['event']=='send_acknowledged' for e in log)
                assert state['enabled'] and len(state['tabIds'])>=3
                await report.evaluate("async()=>await chrome.runtime.sendMessage({type:'AP5_TOGGLE'})")
                print('BROWSER_SMOKE_PASS')
            finally:
                await ctx.close()
if __name__=='__main__':asyncio.run(main())
