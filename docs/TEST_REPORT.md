# Test report — 2026-11-05 (v5.2.0)

## Automated checks

Executed locally:

```bash
npm test
npm run check
python tests/dom-inspect-smoke.py
python tests/background-tab-cdp-smoke.py
python tests/browser-smoke.py
```

**Results:** 24/24 Node tests passed. JavaScript syntax checks passed. Mock DOM/CDP input test and background-tab input test passed. The full installed-extension Playwright smoke did **not** pass: the extension service worker did not appear within the test timeout in the container. This must not be counted as successful end-to-end testing.

## Coverage

- Skip busy, loading, draft and approval states without stopping other conversations.
- Positive completion evidence and two independent matching observations prior to input.
- No Enter after a flickering/composition-in-progress response.
- Durable per-completion idempotency key and uncertain-Enter recovery.
- New assistant completion eligible after a previously handled response.
- Short per-tab retry, acknowledgement and response state machine.
- Real CDP-style mouse click, ArrowUp and Enter in simulated background Chromium pages.

## Not yet validated

- Installed Manifest V3 extension background worker in an interactive real Chrome profile.
- Live ChatGPT UI selectors, tool-use/thinking transient states and real send acknowledgement.
- Ten simultaneous live ChatGPT chats across service worker suspension/reload.
- Limits/behavior of the current ChatGPT web service terms and account-level rate limits.

Treat as **experimental**, not production-ready. Export a sanitized diagnostic report after testing a disposable chat; never publish private chat transcripts.
