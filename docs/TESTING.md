# Verification

Run `npm run check` and `npm test` from the repository root. Unit tests cover simple state transitions; they are not proof of behavior with the current ChatGPT web UI. Chrome background tabs can be throttled and the UI changes over time.

Prior local development verification for v5 (before GitHub publication) reported **18 passing Node tests** and passing syntax checks on 2026-11-05. Those tests were run on the locally generated v5 files, **not** on a live ChatGPT account. The source published here is v5.1 and must be tested independently. Never describe either release as live-end-to-end validated without actual evidence.

For manual validation, start with one disposable chat; confirm no Enter while streaming, then confirm a completed assistant reply triggers exactly one recall and one send. Review the extension event report. Repeat with two tabs, one streaming and one completed. Finally test unexpected content in the composer and an uncertain acknowledgement.
