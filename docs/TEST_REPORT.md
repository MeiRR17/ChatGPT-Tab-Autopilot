# Test report — 2026-11-05 (v5.3.0)

## Executed locally

```bash
npm test
npm run check
python tests/dom-inspect-smoke.py
python tests/background-tab-cdp-smoke.py
python tests/browser-smoke.py
```

- Node unit/runtime tests: **31/31 passed**.
- JavaScript syntax: **passed**.
- Mock Chrome CDP DOM input (mouse click → ArrowUp → Enter): **passed**.
- Background-tab Chrome CDP input without activating the foreground tab: **passed**.
- Full installed-extension Playwright test: **not verified**; this container's Chromium did not register the extension service worker and a `chrome://extensions/` navigation returned `ERR_BLOCKED_BY_ADMINISTRATOR`. This test is **not** counted as passing.
- Live ChatGPT end-to-end test: **not executed**; no authenticated chat environment was available for safe validation.

## New regression coverage

- Navigation away from a chat is a routine skip for a watching tab.
- Navigating away with an uncertain Enter retains review for only that tab.
- A completed-response signal disappearing **after** the durable Enter claim blocks Enter and rolls back the claim.
- A healthy final check results in exactly one Enter keyDown.
- Only a verified, identical, extension-restored prompt is eligible for native draft cleanup after a canceled send.
- A changed/unverified draft is never cleared by cleanup.
- Missing content inspector reinjection is throttled per tab.

## Pre-release acceptance tests on a disposable real account

1. Confirm the ChatGPT interface selectors and ArrowUp behavior match the mock environment.
2. Start in one test chat, verify no attempt is made while generating, reasoning or using tools.
3. Ensure switching tabs, reloading, sleeping and resuming cannot send to the wrong conversation.
4. Test simultaneous completion of 10 conversations, ensuring one send per positively completed response.
5. Trigger a draft and a manual approval modal; verify the monitor skips without changing either.
6. Inspect all local logs for sensitive titles before exporting or sharing.

**Status: EXPERIMENTAL — not approved for unattended production use.**
