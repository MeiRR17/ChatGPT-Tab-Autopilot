"""Verify Chrome CDP can send click + ArrowUp + Enter to background page without changing active tab."""
import asyncio
from playwright.async_api import async_playwright
HTML='''<html><body><div id="prompt-textarea" contenteditable="true" style="border:1px solid black;width:300px;height:50px"></div>
<script>window.clicks=0;window.ups=0;window.enters=0;
const e=document.querySelector('#prompt-textarea');
e.addEventListener('click',()=>window.clicks++);
e.addEventListener('keydown',ev=>{if(ev.key==='ArrowUp'){ups++;e.textContent='תמשיך'};
if(ev.key==='Enter'){ev.preventDefault();enters++}});</script></body></html>'''
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
                                  args=['--no-sandbox','--disable-dev-shm-usage'])
  try:
   ctx=await browser.new_context()
   bg=await ctx.new_page();await bg.set_content(HTML)
   fg=await ctx.new_page();await fg.set_content('<h1>Working normally in other tab</h1>')
   await fg.bring_to_front()
   session=await ctx.new_cdp_session(bg)
   for t, ex in [('mouseMoved',{}),('mousePressed',{'button':'left','clickCount':1}),
                 ('mouseReleased',{'button':'left','clickCount':1})]:
    await session.send('Input.dispatchMouseEvent',{'type':t,'x':50,'y':35,**ex})
   for key,code,v in [('ArrowUp','ArrowUp',38),('Enter','Enter',13)]:
    a={'key':key,'code':code,'windowsVirtualKeyCode':v,'nativeVirtualKeyCode':v}
    if key=='Enter':a.update({'text':'\r','unmodifiedText':'\r'})
    await session.send('Input.dispatchKeyEvent',{'type':'keyDown',**a})
    a.pop('text',None);a.pop('unmodifiedText',None)
    await session.send('Input.dispatchKeyEvent',{'type':'keyUp',**a})
   res=await bg.evaluate('()=>({clicks,ups,enters,focused:document.activeElement.id,visible:document.visibilityState})')
   front=await fg.evaluate('()=>document.visibilityState')
   print('background:',res,'foreground:',front)
   assert res['clicks']==1 and res['ups']==1 and res['enters']==1
   assert front=='visible','activating background tab changed active tab'
   print('BACKGROUND_CDP_SMOKE_PASS')
  finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
