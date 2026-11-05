# Legacy local verification history

This record is a human-readable summary of the local development artifacts from 2026-11-05. It is **not** a live execution log from the installed extension.

| Version | Recorded local result | Major limitation |
|---|---|---|
| 3.x | Simulated scheduling and user-interface inspection tests | No live ChatGPT send verification |
| 4.0.0 | 17 reported code checks and simulated Chrome input check | An active reply could still be misclassified |
| 5.0.0 | 18/18 local Node state-machine tests passed; syntax checks passed | No live end-to-end ChatGPT verification |
| 5.1.0 | Source uploaded to GitHub with English docs and additional completion stability gate | Must be validated independently |

The old local reports were written primarily in Hebrew. No historical personal chat transcripts or browser logs have been imported into GitHub. The v5.1 source is an adapted implementation; its exact test results must not be represented as the v5.0.0 result. The repository intentionally avoids publishing any raw session data.

## Relevant regressions

- An earlier implementation confused an inactive interface with a finished response and sometimes pressed Enter while the assistant was still generating.
- Some errors incorrectly changed the entire run into a stopped or paused state instead of skipping an unavailable tab.
- Repeated Enter without acknowledgement could cause duplicate user messages.

## Acceptance criteria for a future stable release

1. Ten concurrent tabs, with a mixture of active and completed responses.
2. Zero Enter events while a response is streaming, thinking, or running tools.
3. Independent continuation for completed tabs while others remain busy.
4. No duplicate submission after a Chrome service worker restart or unexpected debugger disconnect.
5. Every submission and unexpected state appears in the local exportable event report.
