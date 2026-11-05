# Safety, privacy and release criteria

1. Never submit while a Stop/Cancel-generation control is present, while generation is observed, or until completion has positive UI evidence.
2. Verify the composer is empty before clicking it. Only submit if ArrowUp recalls the expected short continuation prompt.
3. Do not send if a tool call, dialog, review/approval interaction, or draft requires user intervention.
4. Persist per-tab state and acknowledgement boundaries so worker suspension cannot blindly duplicate an Enter.
5. If the last Enter's outcome is uncertain, hold only that tab for manual review and continue other tabs.
6. Keep event logs local. Do not include prompt text, credentials, conversation contents, exported personal logs, or browser profiles in the public repository.
7. Review Chrome debugger permission implications before installation; never ask for extra host permissions unrelated to ChatGPT.
8. The current UI-based completion detector is heuristic, not guaranteed. Test with a real Chrome profile and one low-risk conversation before scaling.
9. Stop the extension immediately if it interrupts generation or produces unintended messages.

## Public release checklist

- [ ] Live end-to-end test on a disposable ChatGPT conversation
- [ ] Background-tab test with an active streamed reply
- [ ] Test a thinking pause and a tool/approval state
- [ ] Test browser restart during pre-send and post-Enter states
- [ ] Examine exported logs for identifying details
- [ ] Decide on a license and explicitly disclose experimental status
