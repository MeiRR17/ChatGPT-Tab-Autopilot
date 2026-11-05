'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'manifest.json'),'utf8'));
test('V5 scoped Chrome extension',()=>{
  assert.equal(manifest.manifest_version,3);
  assert.equal(manifest.version,'5.2.0');
  assert.deepEqual(manifest.host_permissions,['https://chatgpt.com/*','https://chat.openai.com/*']);
  for(const f of ['background.js','content.js','core.js','report.html','report.css','report.js'])
    assert.ok(fs.existsSync(path.join(ROOT,f)),f);
});
test('uses actual mouse click and ArrowUp; no message insertion',()=>{
  const s=fs.readFileSync(path.join(ROOT,'background.js'),'utf8');
  assert.match(s,/Input\.dispatchMouseEvent/);
  assert.match(s,/pressKey\(target,'ArrowUp'/);
  assert.match(s,/pressKey\(target,'Enter'/);
  assert.doesNotMatch(s,/Input\.insertText/);
  assert.doesNotMatch(s,/tabs\.update\([^)]*active\s*:\s*true/);
});
test('continuous per-tab monitoring with recovery alarm, no ten minute interval',()=>{
  const s=fs.readFileSync(path.join(ROOT,'background.js'),'utf8');
  assert.match(s,/periodInMinutes:0\.5/);
  assert.match(s,/Promise\.allSettled\(s\.tabIds\.map\(scheduleTab\)\)/);
  assert.doesNotMatch(s,/periodInMinutes\s*:\s*10|600000/);
});
test('migrate old logs and provide report export',()=>{
  const s=fs.readFileSync(path.join(ROOT,'background.js'),'utf8');
  const r=fs.readFileSync(path.join(ROOT,'report.js'),'utf8');
  assert.match(s,/autopilot3_logs/);assert.match(s,/autopilot4_logs/);
  assert.match(r,/exportJson/);assert.match(r,/exportCsv/);assert.match(r,/exportMd/);
});

test('v5.1 prevents Enter without an enabled Send control',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
  assert.match(source,/function enabledSendControl\(\)/);
  assert.match(source,/const ok=s.loaded && s.focused && enabledSendControl\(\)/);
  assert.match(source,/return \{ok:s.completed && !s.busy && enabledSendControl\(\)/);
});
