# Architecture

Chrome MV3 service worker (`background.js`) coordinates eligible tabs in the window selected by the user. A content script (`content.js`) observes composer state, assistant messages and visible response controls. `core.js` implements per-tab state decisions. `report.html` and `report.js` display local event records.

## State transitions

`watching` → `preparing` → `await_ack` → `await_reply` → `watching`. A tab still generating stays in `watching` or `await_reply`; it is not stopped. A failed focus or unrecognized ArrowUp recall returns to watching. An Enter whose delivery is uncertain must not be retried blindly.

The scheduler reacts to DOM notifications and periodic checks, not a global ten-minute cycle. A tab that is busy does not block a ready tab. The Chrome debugger is attached only to the target tab while sending an input sequence.
