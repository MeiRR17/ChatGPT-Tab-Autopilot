# Changelog

## 5.3.0 — Last-moment Enter gate, safe draft cleanup and lifecycle recovery

- Revalidate completion and the exact conversation URL **after** persisting the pre-Enter state; roll back safely without Enter if the page changes.
- Clear an extension-restored continuation draft after a canceled action only if the composer still contains the exact known prompt. Never erase unverified or human-edited text.
- Treat a monitored tab temporarily navigated away from ChatGPT as a routine skip; retain review state for unacknowledged sends.
- Recover missing content scripts only on verified ChatGPT chat pages and limit reinjection frequency.
- Serialize rapid start/stop controls to avoid overlapping sessions.
- Add runtime worker tests for navigation, final gating, draft cleanup and script recovery; keep existing Chrome CDP smoke probes.
- Update English usage/architecture/testing documentation and correct the exported report version.

## 5.2.0 — Completion consensus and idempotent Enter guard

- Require multiple independent positive confirmations of the exact same completed assistant response before attempting input.
- Track a durable per-tab completion key at the Enter boundary so the same response cannot be sent again after a service-worker interruption.
- Revalidate the conversation URL, composer location, and page state after attaching Chrome Debugger, before clicking.
- Enforce a session-valid atomic claim before dispatching Enter; stale workers must not send.
- Skip modal dialogs and unfinished `Continue generating` states.
- Expand state-machine regression tests for completion flicker, retries, restart recovery, and duplicate prevention.
- Preserve v5 local state/log keys for upgrades; no real chat content is recorded.

## 5.1.0

- Positive completion evidence and enabled Send-control gate.
- Background-tab Chrome Debugger mouse/key input, independent tab monitoring, and local logs.
