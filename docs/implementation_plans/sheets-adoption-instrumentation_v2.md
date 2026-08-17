# Sheets Adoption Instrumentation (v2)

Branch: `claude/sheets-adoption-instrumentation` · Date: 2026-08-17
Supersedes v1 (which shipped the sheets-adoption funnel events). v2 adds
**per-call failure diagnostics** after a real support case: a production user's
`$mcp_tool_call` rows showed `outcome=error` on sheets tools with zero
indication of cause. (Root cause turned out to be a stranded sheet grant —
diagnosable only by cross-referencing five event types and the deploy
timeline.)

## Addition over v1: outcome_reason + result_message on $mcp_tool_call

Two layers, so every non-success call answers "why" directly in PostHog:

1. **`outcome_reason`** — stable snake_case code, set via `addToolCallProps`
   at the site that produced the denial/failure:
   - connection layer: `connection_pending_approval|blocked|no_client_id|user_not_found`
   - account resolution: `no_proxy_key`, `no_accessible_emails`,
     `account_not_accessible`, `google_token_unavailable`
   - send policy: `send_not_whitelisted|send_disabled|send_recipients_unparseable`
   - sheets policy: `sheets_not_exposed|sheets_blocked|sheets_read_only`
   - sheets Google grant: `sheets_grant_missing` (+ `google_status`)
   - reads: `read_restricted`; raw API: `google_api_call_denied`
   - request_access: `request_access_invalid_args`
   - upstream: `google_<status>` / `google_network_error` (+ `google_status`)
2. **`result_message`** — the tool's returned text for non-success outcomes,
   and the thrown error's message on `exception`. Sanitized: URLs stripped
   (approval links embed signed single-use tokens), capped at 200 chars.
   Catch-all for paths no reason code covers.

`outcome` taxonomy itself is unchanged (capability 16 A3 still holds).

## Docs/QA

- `docs/analytics.md`: $mcp_tool_call row + reason-code reference.
- QA capability 16 gains A8: non-success rows carry `outcome_reason`;
  `result_message` present, URL-free, ≤ 200 chars.
