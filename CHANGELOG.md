# Changelog

## 5.1.0 — 2026-11-05

- Added a positive **enabled Send button** gate before Enter to reduce the risk of inadvertently hitting Stop while ChatGPT is generating.
- Localized the report UI and documentation into English; kept detection support for Hebrew continuation prompts and UI labels.
- Documented public-repository privacy rules, experimental limitations, installation and testing.
- Kept continuous independent per-chat monitoring, exact click → ArrowUp → Enter, and a per-chat no-duplicate state machine.

## 5.0.0 — 2026-11-05 (local baseline)

- Added positive completion-action detection on the latest assistant message, beyond simply waiting for the Stop button to disappear.
- Added independent tab monitoring with safe busy-tab skipping and late acknowledgement recovery.
- Added 30-second recovery alarm, in-page mutation notifications and a ~2.2-second pulse.
- Kept Chrome Debugger mouse and keyboard events and local audit-log export.

## 4.x and earlier

- Earlier prototypes attempted timing-based continuation and subsequently added per-tab state and a local reporting dashboard. Historical private exports and unverified run logs are intentionally excluded from the public repository.
