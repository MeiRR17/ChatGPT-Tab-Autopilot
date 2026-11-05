## 5.7.1 — post-handoff continuation bootstrap (2026-11-05)

- Fix the newly opened chat getting stuck after its initial context handoff: wait for the first assistant reply to finish, then insert one short continuation request.
- Once that short user turn has been acknowledged, regular ArrowUp/Enter becomes safe again.
- Preserve all safety gates and per-completion claims; never retry ambiguous Enter.
- Add regression tests for completed/busy handoff replies, bootstrap success, blocked bootstrap and uncertain input.
- Accept common Hebrew continuation phrasing such as `אני רוצה שתמשיך בפיתוח`.

## 5.7.0 — automatic new-chat handoff (experimental)

- Configure a per-conversation rotation threshold (default ten sends) and a delay (default 3.5 seconds) in the Activity Report.
- On the next confirmed completed assistant response after the threshold, click Ask ChatGPT, use ArrowUp to recall the latest continuation request, verify and capture it in memory, and safely clear the old composer.
- Click the actual visible New Chat control via Chrome Debugger, wait for a fresh empty composer, focus it with a mouse click, enter a bounded context handoff and validate it before Enter.
- A new chat **cannot** inherit all prior history; only the latest assistant excerpt and last continuation request are transferred, with a warning to the model about missing history. No conversation bodies are stored in the local event log or GitHub.
- On interrupted or ambiguous navigation, fail closed for only the affected chat. Do not repeat uncertain Enter automatically.
- Extend DOM readiness checks for the modern ChatGPT application shell.

## [5.5.0] - 2026-11-05

- Prevent two Chrome tabs showing the same ChatGPT conversation from independently sending continuations.
- Keep duplicate tabs in the scan set: skip only the secondary input owner, without stopping global monitoring.
- Revalidate ownership before mouse input and after the persistent pre-Enter claim.
- Persist a per-conversation completion claim across tab closure, preventing a second copy from replaying a response; roll back only if Enter was never attempted.
- Add regression tests for duplicate skip, deterministic owner selection, and owner navigation.
- Preserve fail-closed behavior: no Enter on ambiguous ownership.

# Changelog

## 5.4.0 — safety recovery & CI (2026-11-05)

- Recover a verified ArrowUp recall after an unsuccessful post-ArrowUp gate; protect human drafts.
- Remove blind Escape on an invalid ArrowUp result.
- Preserve `await_reply` across temporary navigation after an acknowledged send.
- Mitigate CSV formula injection in local activity exports.
- Add offline GitHub Actions CI and package artifact, plus regression tests.
- Live ChatGPT installed-extension E2E is still unverified.


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
