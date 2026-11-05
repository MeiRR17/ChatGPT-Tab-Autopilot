# Changelog

## 5.1.0 (2026-11-05)
- Initial GitHub source publication with English documentation.
- Per-conversation monitoring; busy conversations are skipped, never globally stopped.
- Positive response-completion checks before focus → ArrowUp → verification → Enter.
- Local audit-log reporting and JSON export.
- Explicit handling of uncertain send acknowledgement to prevent duplicate submissions.

## 5.0.0 (local development)
- Added completion evidence instead of relying exclusively on text stability.
- Fixed routine skips incorrectly becoming global pauses.

## 4.0.0 and earlier (local development)
- Introduced debugger-driven click/ArrowUp/Enter and per-tab scheduling.
- Earlier versions had known risks of interruption and incorrectly stopping generation. Do not install these for production use.
