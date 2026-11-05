# ChatGPT Tab Autopilot

A local Chrome Manifest V3 extension that monitors multiple ChatGPT conversations and only attempts to continue a conversation after its previous assistant response has finished.

> **Development status: experimental.** A successful unit test does not establish that a live ChatGPT session will behave correctly. Test on one disposable conversation before using multiple tabs.

## What it does

- Monitors ChatGPT conversation tabs in the Chrome window where it was activated.
- Skips tabs that are loading, generating a reply, requesting human action, or contain an unsent draft.
- Attempts to focus the **Ask ChatGPT** composer with Chrome's debugger mouse input, press **Arrow Up** to recall the last prompt, verify the recalled prompt, and press **Enter**.
- Tracks each conversation independently. There is **no ten-minute wait**; background checks are reactive and periodic.
- Keeps local event logs and a report that can be exported.
- Does not change the operating system's mouse cursor or switch the selected Chrome tab.

## Install (unpacked Chrome extension)

1. Download or clone this repository and ensure `manifest.json` is at the folder root.
2. In Chrome, open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked**, then choose the repository folder.
4. Disable any older Autopilot installations so only one automation is active.
5. Open your intended ChatGPT conversations in the **same Chrome window**.
6. Click the extension's toolbar icon to start, and click it again to stop.
7. Use the extension's options page / context menu to inspect the event log.

## Safety boundaries

**Never press Enter solely because the page looks idle.** An assistant can pause during a reply without having completed it. The extension must observe affirmative evidence of a completed assistant response and an empty, available composer. An uncertain tab is skipped and revisited; it must not stop other tabs.

When Enter may already have been delivered but acknowledgement is absent, the affected tab must be held for review rather than blindly repeated. This is different from a routine skip.

The extension uses the powerful `debugger` permission. Chrome may display a debugging warning. The extension is designed for local use and does not require a third-party backend. **Do not commit personal conversation exports, tokens, cookies, or raw private logs.** Exported logs may expose tab names and metadata.

## Limitations

- ChatGPT's interface and selectors change, and keyboard recall behavior is not a documented stable API.
- Chrome may throttle background tabs and service workers.
- Tool activity, thinking pauses, dialogs, and changed conversation state can make completion ambiguous.
- The extension cannot guarantee a continuation will never interrupt an active reply. Supervise an initial one-tab test.
- This project is **unofficial** and is not affiliated with OpenAI.

## Development

```bash
npm test
npm run check
```

See `docs/ARCHITECTURE.md`, `docs/SAFETY.md` and `CHANGELOG.md` for design and release notes.

## License

No open-source license has been selected. Public visibility alone does not grant permission to reuse, modify, or redistribute this repository.
