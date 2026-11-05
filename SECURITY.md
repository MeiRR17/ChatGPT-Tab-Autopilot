# Security and privacy

The extension uses Chrome `debugger` permission. This is powerful: it can emulate input and observe the target tab. The source should be reviewed before use; never treat a public extension repository as proof that a binary install is safe.

**Do not publish** user activity exports, chat text, tab titles from real sessions, login tokens, profiles, cookies or API credentials in issues, PRs, sample logs or commits. The extension does not intentionally upload telemetry, but locally exported reports may contain sensitive tab titles and metadata.

Report potential vulnerabilities privately to the repository owner instead of publishing account/session data in an issue. If the behavior can stop an in-progress response or submit the wrong prompt, stop using the extension until fixed.

Limitations: DOM signals are heuristics; no frontend-only extension can guarantee perfect recognition of server-side generation state. Chrome background execution and tab lifecycle are asynchronous; a send/ack timeout leads to per-conversation review rather than an automatic retry.
