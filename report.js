'use strict';
const STATE_KEY = 'autopilot5_state';
const LOG_KEY = 'autopilot5_logs';
const LEGACY_KEY = 'autopilot5_previous_snapshot';
const SETTINGS_KEY = 'autopilot5_settings';
let state = {enabled: false, tabIds: [], items: {}};
let logs = [];
let legacy = null;
const $ = id => document.getElementById(id);
const fmtTime = timestamp => timestamp ? new Date(timestamp).toLocaleString('en-US', {dateStyle: 'short', timeStyle: 'medium'}) : '—';
const cleanCsv = AutopilotReportUtils.cleanCsv;
function td(row, value, cls) {
  const element = document.createElement('td');
  if (cls) element.className = cls;
  if (value instanceof Node) element.append(value);
  else element.textContent = String(value ?? '');
  row.append(element);
}
function blankRow(target, text, span) {
  const tr = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = span;
  cell.textContent = text;
  tr.append(cell); target.replaceChildren(tr);
}
function renderSummary() {
  const items = Object.values(state.items || {});
  const count = items.filter(x => x.phase === 'needs_review').length;
  $('state-pill').textContent = state.enabled ? 'Monitoring active' : 'Monitoring off';
  $('state-pill').className = state.enabled ? 'pill on' : 'pill';
  $('toggle').textContent = state.enabled ? 'Stop monitoring' : 'Start monitoring';
  $('toggle').className = state.enabled ? 'primary stop' : 'primary';
  $('tabsCount').textContent = items.length.toLocaleString('en-US');
  $('sentCount').textContent = items.reduce((n, x) => n + (x.sent || 0), 0).toLocaleString('en-US');
  $('errorCount').textContent = count.toLocaleString('en-US');
  $('eventCount').textContent = logs.length.toLocaleString('en-US');
  $('last-refresh').textContent = `Updated ${new Date().toLocaleTimeString('en-US')}`;
}
function renderTabs() {
  const body = $('tabs-body'); body.replaceChildren();
  const items = Object.entries(state.items || {});
  if (!items.length) return blankRow(body, 'No monitored conversations. Open ChatGPT chats and click the extension icon.', 5);
  for (const [id, item] of items) {
    const tr = document.createElement('tr');
    td(tr, `${item.name || 'Conversation'}  (#${id})`);
    const tag = document.createElement('span'); tag.textContent = item.status || item.phase || 'Unknown';
    tag.className = `status ${item.phase || ''}`;
    td(tr, tag);
    td(tr, item.sent || 0);
    td(tr, fmtTime(item.lastUpdatedAt));
    td(tr, item.reason || '—');
    body.append(tr);
  }
}
function refreshFilter() {
  const select = $('tabFilter'); const prev = select.value;
  const existing = [...new Set(logs.filter(e => e.tabId !== null).map(e => e.tabId))];
  select.replaceChildren(new Option('All tabs', 'all'));
  for (const id of existing) {
    const title = logs.findLast(e => e.tabId === id)?.title || `Tab ${id}`;
    select.add(new Option(`${title} (#${id})`, String(id)));
  }
  select.value = [...select.options].some(o => o.value === prev) ? prev : 'all';
}
function renderLogs() {
  const body = $('logs-body'); body.replaceChildren();
  const query = $('search').value.trim().toLowerCase();
  const level = $('severity').value;
  const tab = $('tabFilter').value;
  const matching = logs.filter(e => (level === 'all' || e.level === level) &&
    (tab === 'all' || String(e.tabId) === tab) &&
    (!query || `${e.event} ${e.title} ${e.message} ${e.tabId}`.toLowerCase().includes(query)));
  $('shown').textContent = `${matching.length.toLocaleString('en-US')} matching records`;
  if (!matching.length) return blankRow(body, 'No matching events', 5);
  // Keep dashboard responsive; JSON/CSV/MD exports always include every saved event.
  for (const e of matching.slice(-500).reverse()) {
    const tr = document.createElement('tr');
    td(tr, fmtTime(e.timestamp));
    const tag = document.createElement('span'); tag.textContent = e.level || 'info';
    tag.className = `event-level ${e.level || 'info'}`;
    td(tr, tag); td(tr, e.event); td(tr, e.tabId === null ? 'General' : `${e.title || 'Conversation'} (#${e.tabId})`);
    td(tr, e.message); body.append(tr);
  }
}
function renderLegacy() {
  if (!legacy) return;
  const items = Object.values(legacy.items || {});
  const total = items.reduce((n, item) => n + (item.sent || 0), 0);
  $('legacy').textContent = `Previous-version snapshot: ${items.length} conversations, ${total} sends in previous session. Prior logs import only if the extension ID stays the same.`;
}
function render() { renderSummary(); renderTabs(); refreshFilter(); renderLogs(); renderLegacy(); }
async function loadRotationSettings(){
  const settings=(await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]||{};
  $('rotateEnabled').checked=settings.rotateEnabled!==false;
  $('rotateAfter').value=settings.rotateAfter||10;
  $('rotateDelay').value=(settings.rotateDelayMs||3500)/1000;
}
$('saveRotation').addEventListener('click',async()=>{
  const resp=await chrome.runtime.sendMessage({type:'AP5_SETTINGS',settings:{
    rotateEnabled:$('rotateEnabled').checked,rotateAfter:Number($('rotateAfter').value),
    rotateDelayMs:Math.round(Number($('rotateDelay').value)*1000)}});
  $('rotationSaved').textContent=resp?.ok?'Saved':'Could not save settings';
  if(resp?.ok)await loadRotationSettings();
});
async function refresh() {
  const found = await chrome.storage.local.get([STATE_KEY, LOG_KEY, LEGACY_KEY]);
  state = found[STATE_KEY] || state; logs = found[LOG_KEY] || []; legacy = found[LEGACY_KEY] || null;
  render();
}
function download(name, mime, content) {
  const blob = new Blob([content], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
function exportJson() {
  download(`autopilot-report-${stamp()}.json`, 'application/json;charset=utf-8',
    JSON.stringify({exportedAt: new Date().toISOString(), version: '5.7.2',
      note: 'Conversation message bodies are not logged; v4 logs are imported only from the same extension ID.',
      state, legacySnapshot: legacy, totalSavedEvents: logs.length, logs}, null, 2));
}
function exportCsv() {
  const rows = [['time', 'level', 'event', 'tab_id', 'tab_title', 'description'],
    ...logs.map(e => [e.timestamp, e.level, e.event, e.tabId ?? '', e.title, e.message])];
  download(`autopilot-logs-${stamp()}.csv`, 'text/csv;charset=utf-8',
    '\uFEFF' + rows.map(r => r.map(cleanCsv).join(',')).join('\r\n'));
}
function exportMd() {
  const items = Object.entries(state.items || {});
  const lines = ['# ChatGPT Tab Autopilot — Activity report', '',
    `- Exported: ${new Date().toLocaleString('en-US')}`,
    `- Monitoring: ${state.enabled ? 'active' : 'off'}`,
    `- Conversations: ${items.length}`,
    `- Send attempts: ${items.reduce((n, [,x]) => n + (x.sent || 0), 0)}`,
    `- Log entries: ${logs.length}`, '',
    '## Conversation status', '', '| Tab ID | Title | Status | Sends | Reason |', '|---|---|---|---:|---|',
    ...items.map(([id,x]) => `| ${id} | ${String(x.name).replace(/\|/g, '/')} | ${x.status} | ${x.sent} | ${String(x.reason || '—').replace(/\|/g, '/')} |`),
    '', '## Event log (saved records)', ''];
  for (const e of logs) lines.push(`- ${e.timestamp} · **${e.level}** · ${e.event} · ${e.title || e.tabId || 'General'}: ${e.message}`);
  lines.push('', '## Limitations', '', 'Only recorded events can be exported. Message bodies are not stored in logs.', '');
  download(`autopilot-report-${stamp()}.md`, 'text/markdown;charset=utf-8', lines.join('\n'));
}
$('toggle').addEventListener('click', async () => {
  $('toggle').disabled = true;
  try { await chrome.runtime.sendMessage({type: 'AP5_TOGGLE'}); await refresh(); }
  catch (err) { alert(`Operation failed: ${err.message || err}`); }
  finally { $('toggle').disabled = false; }
});
$('search').addEventListener('input', renderLogs);
$('severity').addEventListener('change', renderLogs);
$('tabFilter').addEventListener('change', renderLogs);
$('exportJson').addEventListener('click', exportJson);
$('exportCsv').addEventListener('click', exportCsv);
$('exportMd').addEventListener('click', exportMd);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[STATE_KEY]) state = changes[STATE_KEY].newValue || state;
  if (changes[LOG_KEY]) logs = changes[LOG_KEY].newValue || [];
  if (changes[LEGACY_KEY]) legacy = changes[LEGACY_KEY].newValue || null;
  render();
});
loadRotationSettings().catch(()=>{});
refresh().catch(err => { $('state-pill').textContent = `Unable to load: ${err.message}`; });
