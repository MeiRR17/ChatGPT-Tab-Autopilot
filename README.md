# ChatGPT Tab Autopilot

**Version 5.7.2 — experimental local Chrome extension, Manifest V3.**

Monitors existing ChatGPT conversations in the **same Chrome window** without switching tabs or taking over your physical keyboard/mouse. When a conversation **positively appears finished**, the extension attempts this exact sequence inside that tab:

1. Verify the latest assistant turn has completed and the page is stable (approximately 5 seconds, followed by cross-sample confirmation).
2. Click inside the **Ask ChatGPT** composer using Chrome Debugger input.
3. Press **ArrowUp** once to recall the last user prompt.
4. Verify the restored text is the same short continuation request as the last user message, and confirm the **Send** button is enabled.
5. Press **Enter** once; wait for message acknowledgement and a **new completed assistant reply** before any subsequent send.

**Busy, loading, drafting and unconfirmed conversations are skipped and rescanned.** Two independent observations of the same completed reply are required before sending, and a persistent completion key blocks re-sending the same response after a crash or restart. There is no 10-minute batch delay. Each tab emits change notifications and a short periodic pulse; a 30-second recovery alarm helps after Chrome suspends background work.

> **Experimental:** This is not an official OpenAI product. ChatGPT's DOM is undocumented and changes frequently. Local tests have passed, but a live ChatGPT end-to-end send has **not** been validated for this release. Never rely on it without supervision; test on one disposable chat first. It cannot guarantee no accidental interruption in every UI state.

## Install

1. Download this repository as ZIP, or clone it. Keep the extension files in a persistent local folder (the root containing `manifest.json`).
2. Open `chrome://extensions`, turn on **Developer mode**, select **Load unpacked**, and choose that folder.
3. Disable/uninstall older Autopilot versions if separate copies are installed; two enabled copies could send twice.
4. Pin the extension using Chrome's Extensions menu. Open ChatGPT conversations in the **same window**.
5. Click the Autopilot icon **once to start**, and **again to stop**. Right-click the icon and open **Activity report and logs** to inspect the run and export CSV, JSON or Markdown.

If upgrading an already-loaded unpacked extension, back up the folder and **replace files in place**, then click **Reload** on `chrome://extensions`; installing as a new extension will create a different extension ID and lose access to old local log storage. The upgrade tries to import v3/v4 event entries if present, but events that were never saved cannot be recovered.

## Safety behavior

| Situation | Behavior |
| --- | --- |
| ChatGPT is generating, reasoning or awaiting tool output | Skip that conversation; rescan independently. |
| Page incomplete, hidden composer, draft or manual approval | Skip and retry when state changes. |
| Last user message is not a short `continue`/`keep going`/`תמשיך`/`המשך` request | Do not send. |
| No positive completed-turn action or enabled Send control | Do not send. |
| ArrowUp fails or restores unexpected text | Do not press Enter. |
| Enter might have been delivered but no acknowledgement arrived | Mark **only this conversation** as `needs_review`; never blindly resend. |
| New answer is being generated | Never send another request until that answer has been positively verified complete. |
| Maximum of 100 sends to a conversation per session | Stop sending to that conversation. |

**What “independent” means:** The extension targets background tabs by their Chrome tab IDs using the `chrome.debugger` permission, without activating the tab and without sending OS-wide keypresses. This is high-privilege access; only install code you trust. Chrome may show a debugger warning while the extension is using it. Background tabs may be throttled, so “continuous” does **not** mean a guaranteed millisecond response time.

## Privacy and permissions

- Only exact ChatGPT host permissions: `https://chatgpt.com/*` and `https://chat.openai.com/*`.
- No external network reporting or analytics; activity data stays in `chrome.storage.local` (up to the latest 5,000 events).
- The extension does **not** intentionally log message bodies, but stores tab titles, timestamps, short error/reason strings, and per-chat message fingerprints/metadata in local state; exported reports may reveal sensitive context via tab titles.
- It requests `debugger` (synthetic mouse/keyboard within a tab), `tabs` (tab enumeration), `storage` (local state), `alarms` (recovery), `scripting` (reinject content script after service-worker restart), and `contextMenus` (open report).
- Never commit a real exported activity report, browser profile, login cookie, or conversation content to a public repository.

## Run local checks

Requires Node.js with `node:test`. No package installation is necessary.

```bash
npm test
npm run check
```

Optional Chromium/Playwright smoke probes are in `tests/` and may require Python, Playwright and a local Chromium installation. `AUTOPILOT_HEADED=1` runs the installed-extension smoke with a real display (for example under Xvfb); this has not passed in the present container. They are **not** substitutes for a live-account validation.

## Troubleshooting

- **Chat still generating, but extension sends:** Stop immediately; export the report and open an issue with *sanitized* observations. This is a safety defect.
- **The tab is skipped repeatedly:** Inspect the reason in the activity report. If no completed-turn action or enabled Send control is detected, the extension fails closed rather than pressing Enter on Stop.
- **ArrowUp edits the earlier message instead of recalling it:** The message fingerprint check prevents Enter. The interface behavior may have changed.
- **Chrome reports “debugger detached” or another extension is debugging the tab:** Avoid running other debugger tools on the same tabs.
- **No events restored after installing a new copy:** Local storage is scoped to an extension ID. Preserve the old installation and export the old report first.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md), [`SECURITY.md`](SECURITY.md), and [`CHANGELOG.md`](CHANGELOG.md). A public repository should contain **source and synthetic evidence only**, not real user logs.

## v5.3 reliability improvements

- A completed assistant response must remain **exactly the same across at least two independent polls**, separated by at least 1.8 seconds (after the DOM's 5-second stability gate). This adds latency intentionally to avoid interrupting a thinking/working response.
- Before clicking, the debugger code checks that the tab still displays the **same conversation URL** and that the composer is still eligible.
- Before Enter, the service worker stores the exact completion key and requires a session-valid claim. If Chrome stops the worker near the Enter boundary, the extension must observe a new acknowledged user turn rather than blindly re-send.
- Temporary UI instability never pauses the whole run: the tab is skipped and rescanned. Genuine delivery uncertainty is isolated to that conversation (`needs_review`).

**Important:** A Chrome extension cannot obtain an authoritative "model finished" event from the ChatGPT web UI. These DOM checks are best-effort, not a guarantee. For workflows requiring reliable completion signals, use an API integration designed for automation rather than simulating keystrokes in the consumer UI.


### v5.3 changes (reliability maintenance)

- **Final authorization check after persistence.** The extension now rechecks the completed-response signal *after* writing the idempotency marker and immediately before Enter. If the model resumed producing during that storage operation, Enter is not sent and the claim is safely rolled back.
- **Draft cleanup after a rejected send.** If ArrowUp restored the original continuation request but a subsequent safety check fails, the extension tries to clear that restored request with native keyboard input **only if** the field still contains the exact verified request and has focus. User-authored or uncertain text is never erased. If cleanup cannot be verified, the event log records this and the chat is not sent.
- **Navigation-safe skips.** Switching a monitored tab away from a chat no longer turns an ordinary watching conversation into `needs_review`. In-flight/uncertain submissions remain protected.
- **Content-script recovery.** A missing inspector is reinjected in a supported chat with a 10-second per-tab retry throttle and independently monitored recovery.
- **Serialized start/stop.** Rapid toolbar/report toggles cannot create two competing monitoring sessions.

These changes do **not** make the Chrome UI an authoritative completion signal. The extension remains experimental and must be validated against the current ChatGPT website before broad use.

## v5.5: recovery, CSV safety and reproducible CI

- If ArrowUp restores the exact last continuation text but **completion becomes unconfirmed**, cancel Enter and attempt a narrowly scoped cleanup of only that exact recalled text. Previously this failure path could strand a draft and cause endless skips. If its origin cannot be confirmed, **no cleanup takes place**; the conversation will wait for manual attention while other tabs continue.
- Never issue a blind Escape when ArrowUp does not yield a valid composer: this could otherwise dismiss a human-controlled interface.
- If a continuation was **already acknowledged**, navigating away while waiting for its answer is a temporary skip, not an uncertain-Enter quarantine. Returning to the same chat resumes monitoring.
- CSV export now neutralizes spreadsheet formula prefixes in untrusted tab names/event descriptions.
- A GitHub Actions workflow runs `npm run check`, `npm test` and packages the unpacked extension. No live ChatGPT data or credentials are used in CI.

The new tests are still synthetic. **Installed extension E2E and live ChatGPT E2E are pending** and must not be represented as passed.

## Duplicate conversations (v5.5)

When the same conversation URL is open in multiple monitored tabs **in the same Chrome window**, only the lowest-ID live monitored tab may send. Other copies are skipped, not marked failed; after closing or navigating away from the owner, another tab can become eligible. The guard is checked before clicking and again directly before Enter. A session-scoped durable completion claim also prevents another copy from resending the same response after the original tab closes; the claim is rolled back only if Enter was never attempted. This is a **local tab de-duplication guard**, not a distributed lock across profiles, windows or devices. Do not use multiple browser profiles to automate the same conversation.

## Automatic new chat after N continuations (v5.7.2 experimental)

Open the extension's **Activity report**, find **Automatic new chat handoff**, and set the threshold (default: 10 successful continuation send attempts per monitored conversation) and delay before Enter (default: 3.5 s). The same tab is used. Once the threshold is reached **and the current response is positively completed**, the extension clicks the old composer, performs ArrowUp, validates the recalled prompt, clears it safely, clicks the visible **New Chat** control, waits for the new blank editor, pastes a bounded excerpt of the last assistant reply plus the previous continuation instruction, verifies the new draft, and then presses Enter.

**Context limitation:** The full prior conversation is not automatically transferred. Do not use this as a substitute for an explicit project handoff or durable project state. The excerpt travels in-memory only, and is not written to local storage, diagnostics, or version control. If any step is uncertain, that tab is skipped or marked as requiring review; the other tabs continue. An interrupted rollover is *never* blindly retried.

### One-time short continuation after the new chat handoff (v5.7.2)

The initial handoff is long and would be incorrectly repeated by ArrowUp. When ChatGPT finishes its **first** answer in the new chat, the extension therefore sends one short language-matched continuation request using tab-local text input (Hebrew: `תמשיך את הפיתוח`; English: `Continue the development.`). It confirms the positive completion signal and Send button before that Enter, and persists a crash-safe idempotency claim. After that one-time bootstrap, the normal mouse click → ArrowUp → Enter sequence resumes. No long handoff prompt is repeatedly replayed.

### Report controls authentication (v5.7.2)

The report is itself a Chrome extension tab. Monitoring toggles and rollover settings are accepted only from the exact `chrome-extension://<this-extension-id>/report.html` page, including when Chrome supplies `sender.tab`. Ordinary websites, content scripts and other extensions cannot invoke these controls.
