# Changelog

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
