# Test report — 2026-11-05

## Automated checks

Executed against the local source baseline and re-executed for v5.1.0:

```bash
npm test
npm run check
```

**Observed result:** 19 of 19 Node unit checks passed; JavaScript syntax checks passed; DOM/CDP mock smoke passed; background-tab CDP smoke passed. The installed-extension Playwright E2E probe did **not** run successfully because the Chrome extension service worker did not load within the test timeout in the container. It is not counted as passing.

The Node.js unit checks cover independent busy-tab skipping, positive completion gating, draft/approval/loading skip, no retries while waiting for acknowledgement/reply, late acknowledgements, interrupted Enter, per-conversation maximum send count and local extension structure. The smoke probes under `tests/` exercise simulated DOM / CDP behavior when their optional dependencies are installed.

**Not verified:** a complete end-to-end run on a live ChatGPT account and actual Chrome browser UI. Do not claim the extension is production-safe on this evidence alone.

## Privacy of test records

No live user chat transcripts or actual locally exported usage logs are committed. The sample file below is fictional test data. When debugging a live installation, export logs from the extension and sanitize before sharing.
