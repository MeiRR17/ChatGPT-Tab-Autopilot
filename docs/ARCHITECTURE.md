# Architecture and operating model

- `background.js`: MV3 service worker, monitoring session, tab-level task queue, Chrome debugger input, persistence, event logging and local report entrypoint.
- `core.js`: deterministic state machine for each conversation. A busy/unready tab remains in `watching`. `await_ack` and `await_reply` prohibit duplicate Enter during a pending response. Ambiguous Enter delivery enters `needs_review` only for that tab.
- `content.js`: read-only DOM inspection (chat path, last user prompt, assistant completion actions, stop/approval signals, visible composer, prompt fingerprint), and coordinate/focus assertions for the input sequence. It does not inject chat message text.
- `report.html`, `report.js`, `report.css`: local diagnostics and CSV/JSON/Markdown export. No external telemetry.

## Sequence

1. User starts monitoring for ChatGPT conversation tabs in the selected window.
2. Each tab has a content-script mutation observer, short polling pulse and a longer service-worker recovery alarm.
3. A tab is eligible only if it is loaded, no generation indicator is active, the latest assistant response has a visible completion action, its content is stable, the composer is empty, and the last user message is a short continuation prompt.
4. Cross-sample consensus confirms the exact same response identity after the stability window, and the same conversation URL and composer are rechecked after debugger attachment.
5. After a tab-local debugger click, verify focus; send **one ArrowUp**; ensure the recovered text fingerprint matches the original user prompt and that an enabled **Send** button (not Stop) exists.
6. Recheck immediately before Enter. Atomically persist a completion-key lease and `sending` state before dispatching Enter. If worker execution ends near the Enter boundary, do **not** send twice without observing a new user message.
7. Wait for a newly acknowledged user message, and then for a new completed assistant response. Only then consider a subsequent continuation request.

## Invariants

- Never use Ctrl+Tab or take over the physical keyboard/mouse.
- No global stop on busy/unready tabs.
- Never press Enter solely because text stopped changing or a Stop button disappeared.
- Never retry an ambiguous Enter on the same chat automatically.
- Never overwrite a draft or send arbitrary user text.

## Known limitations

ChatGPT's UI is not a stable documented API. Completion actions, editor markup, send-button labels and ArrowUp behavior may change. Background-tab timers may be throttled; Chrome may unload service workers. The checks aim to fail closed but cannot guarantee zero false positives. E2E against a real account is still pending.
