# Approval-funnel nudges & error actionability — v2

Supersedes v1 after Ken's product direction (2026-08-19, same session):

1. **Agent sheet creation is now supported** — `POST v4/spreadsheets` forwards
   to Google and the created id is auto-granted (read & write rule named
   "Agent-created: <title>", scoped to the calling proxy key via
   key_rule_assignments). Rationale: the Sheets policy exists to keep agents
   out of the user's EXISTING sheets, not to stop them creating their own.
   drive.file scope already means the app only reaches picked + app-created
   files. New event: `agent_sheet_created` (auto_granted: bool);
   `sheet_created: true` stamped on the tool-call event.
   `sheets_create_unsupported` denial code retired (kept in insight SQL for
   pre-change history).
2. **Unknown Google API families pass through instead of denying**
   (`raw_api_not_exposed` retired): forwarded with the account token — OAuth
   scopes are the backstop — and stamped `raw_api_passthrough: true` +
   `raw_api_family` so demand is classified, not blocked. Enforcement gets
   built per-family when usage shows up.
3. **Batch stays denied but is explicitly monitored**: batch can smuggle
   sub-requests past the send whitelist and read restrictions (enforcement
   that exists today), so it keeps the block; every attempt stamps
   `denial_code: 'raw_api_batch_unsupported'` and the monitoring insight
   charts attempts. If demand appears, the right solution is per-sub-request
   policy evaluation, not passthrough.
4. `gmail_write_unsupported` unchanged (only messages/send is enforceable
   against the send whitelist today).

QA capability 10 A3/A9 updated accordingly. PostHog insight yQ0ttGSp revised
to chart: created sheets, historical create-denials, sheet-access denials,
batch attempts, passthrough volume; new companion insight breaks passthrough
down by raw_api_family.
