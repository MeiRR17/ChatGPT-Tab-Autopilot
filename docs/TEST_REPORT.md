# Test report — v5.7.1 (2026-11-05)

## Current local verification

- `npm test`: **60/60 passed** (Node 22 offline unit and worker-regression tests).
- `npm run check`: **PASSED** (all extension JavaScript syntax).
- `python tests/app-shell-smoke.py`: **PASSED** — synthetic modern ChatGPT DOM, CDP click/ArrowUp/Enter.
- `python tests/new-chat-dom-smoke.py`: **PASSED** — synthetic browser New Chat navigation, old prompt recall, editor focus, CDP Input.insertText, and one Enter.
- One-time new-chat continuation bootstrap: **3 worker-runtime tests and 2 state-machine tests passed** (included in Node suite).
- Installed full Chrome extension against an authenticated ChatGPT account: **NOT PERFORMED**.
- GitHub Actions: must be rechecked after pushing this commit.

## Scope and limits

Browser smokes use local synthetic pages; no live authenticated ChatGPT session was accessed. The New Chat transition depends on undocumented DOM selectors and chat-history truncation is inherent to a new conversation. This release is experimental: do not enable unattended operation on sensitive work until a user-validated live Chrome test passes. If an ambiguous Enter or navigation occurs, the extension holds only that conversation and never blindly resends.

---

# Test report — v5.5.0 (2026-11-05)

The v5.5 cycle adds duplicate-conversation ownership checks and offline regression tests.
No live ChatGPT automation was executed in this environment; installed-extension E2E remains an unresolved release gate.

# Test report — v5.4.0 (2026-11-05)

## Results in this build container

| Verification | Status |
| --- | --- |
| `npm test` | **42/42 passed** (offline Node tests) |
| `npm run check` | **Passed** (JavaScript syntax) |
| Manifest V3 and package assertions | **Passed** (included in Node tests) |
| Two separate background-tab CDP simulations | **Not re-run for this version**; older v5.3 smoke results remain historical only |
| Installed-extension Chromium E2E | **NOT VERIFIED** (service worker not registered under headless; optional headed run also timed out) |
| Authenticated ChatGPT E2E | **NOT PERFORMED** |
| GitHub Actions workflow | **Added**; hosted CI result must be checked after pushing |

## CI regression discovered and resolved

The first v5.4 GitHub Actions run found six failing historical tests in `tests/core.test.js`, a file that existed on the GitHub branch but was missing from the previous local release ZIP. The old tests used the removed `Core.initial` API. They have been **rewritten against `newItem` and `decide`**, preserving all six regression cases. The complete tracked test suite now has 42 passing local tests. Await GitHub Actions to confirm the updated commit.

## New regression scenarios

- `AP5_AFTER_UP` rejected even after ArrowUp: *only* an exactly verified recalled prompt is cleared, with no Enter.
- Refused ArrowUp result plus non-matching human draft: no cleanup, Escape, or Enter.
- Temporary navigation after an **acknowledged** continuation retains `await_reply` (no false uncertain-delivery hold).
- Local CSV export prevents spreadsheet formulas via untrusted tab titles, retains CSV escaping and strips control characters.

## Release limitations

No test exercises a logged-in ChatGPT page. ChatGPT's UI does not provide a supported completion notification and may change; **the extension is still experimental, and this CI is not proof of safe unattended operation**. Validate with one disposable chat before enabling the intended 10-tab workflow. Synthetic and historical tests must remain labeled separately from live E2E.

---

## Previous release (v5.3.0) — historical results

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
