# Architecture and operating model

- `background.js`: MV3 service worker, monitoring session, tab-level task queue, Chrome debugger input, persistence, event logging and local report entrypoint.
- `core.js`: deterministic state machine for each conversation. A busy/unready tab remains in `watching`. `await_ack` and `await_reply` prohibit duplicate Enter during a pending response. Ambiguous Enter delivery enters `needs_review` only for that tab.
- `content.js`: read-only DOM inspection and non-destructive restoration verification (chat path, last user prompt, assistant completion actions, stop/approval signals, visible composer, prompt fingerprint), and coordinate/focus assertions for the input sequence. Ordinary continuation uses physical-equivalent ArrowUp only. An intentional new-chat handoff inserts a bounded contextual seed with Chrome Debugger Input.insertText, without using the physical clipboard.
- `report.html`, `report.js`, `report.css`: local diagnostics and CSV/JSON/Markdown export. No external telemetry.

## Sequence

1. User starts monitoring for ChatGPT conversation tabs in the selected window.
2. Each tab has a content-script mutation observer, short polling pulse and a longer service-worker recovery alarm.
3. A tab is eligible only if it is loaded, no generation indicator is active, the latest assistant response has a visible completion action, its content is stable, the composer is empty, and the last user message is a short continuation prompt.
4. Cross-sample consensus confirms the exact same response identity after the stability window, and the same conversation URL and composer are rechecked after debugger attachment.
5. After a tab-local debugger click, verify focus; send **one ArrowUp**; ensure the recovered text fingerprint matches the original user prompt and that an enabled **Send** button (not Stop) exists.
6. Recheck before Enter, atomically persist a completion-key lease and `sending` state, then recheck completion and URL **again after the storage write**. If that final check fails, roll back before any Enter. If the worker stops near Enter, treat delivery as uncertain. If worker execution ends near the Enter boundary, do **not** send twice without observing a new user message.
7. Wait for a newly acknowledged user message, and then for a new completed assistant response. Only then consider a subsequent continuation request.

## Invariants

- Never use Ctrl+Tab or take over the physical keyboard/mouse.
- No global stop on busy/unready tabs.
- Never press Enter solely because text stopped changing or a Stop button disappeared.
- Never retry an ambiguous Enter on the same chat automatically.
- Never overwrite a draft or send arbitrary user text.

## Known limitations

ChatGPT's UI is not a stable documented API. Completion actions, editor markup, send-button labels and ArrowUp behavior may change. Background-tab timers may be throttled; Chrome may unload service workers. The checks aim to fail closed but cannot guarantee zero false positives. E2E against a real account is still pending.


## Recovery details (v5.3)

- Missing content script: throttle reinjection attempts to once per tab per 10 seconds. No input is sent based on an absent inspector.
- Temporary non-chat URL: routine `watching` skip; the user can navigate back and resume. If Enter may have been delivered, remain in review to prevent duplicate submission.
- A restored prompt left after a failed final safety gate is **never deleted**. The tab is moved to `needs_review` (other tabs keep running), so the worker does not replay ArrowUp endlessly. Read-only composer verification uses bounded polling for a delayed Send button.
- Toolbar and report toggles use one serialized toggle queue, preventing rapid-click overlap.

## Verification boundary

The page's DOM can change between every check and every key event. There is no atomic server-side completion API exposed to this extension. The final page check reduces a known race but cannot eliminate that fundamental limitation. For unattended production-grade automation, use a supported API and explicit completion events rather than browser keystrokes.

## New Chat rollover (v5.7.0)

Per-tab settings control a threshold of acknowledged continuation attempts (default 10) and a 2–15-second new-chat verification delay (default 3.5s). On the next positively completed assistant response, the worker claims the original completion and uses the same tab's CDP channel to click the composer and ArrowUp. It captures the verified continuation text and the latest assistant response excerpt *in memory*, cleans the old draft after exact matching, clicks a visible New Chat control, waits for a fresh editor, inserts a bounded handoff, verifies the new text/Send button and sends one Enter. The entire previous conversation is **not** transferred.

The state machine records a durable `rotating` state before navigation and `rotating_enter` before Enter. On worker restart or uncertain delivery, it quarantines only that tab rather than replaying the new-chat request. When `/c/<new id>` appears, the worker compares the last user message fingerprint with the verified handoff signature and then waits for the new completed reply. The new chat remains in the same monitored Chrome tab. No message bodies are stored in persistent state or diagnostics.

## One-time short prompt bootstrap (v5.7.1)

The long handoff is intentionally not eligible for ArrowUp. Following the first positively completed assistant reply in the fresh chat, `bootstrapPending` gates a tab-local mouse focus and one-time `Input.insertText` for a generic short continuation (Hebrew or English), verified again before Enter. A durable per-completion claim is persisted before this Enter; ambiguous delivery quarantines only that tab. After a new short user turn is acknowledged, the ordinary ArrowUp loop resumes and the next rollover threshold is counted from the new-chat handoff.

## v5.8: non-destructive recovery

The worker does not send Ctrl/Cmd+A, Backspace or Escape. If ArrowUp is dispatched but verification fails, it preserves the draft and holds only that tab for manual review. A once-only ArrowUp dispatch is followed by bounded polling, not by repeated ArrowUp. Automatic rollover likewise never clears the old draft and only continues when the new editor is verifiably blank.
