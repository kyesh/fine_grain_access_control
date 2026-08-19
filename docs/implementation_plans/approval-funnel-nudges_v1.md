# Approval-funnel nudges & error actionability — v1

Branch: `claude/approval-funnel-nudges` (off `main` @ f5bfb5b)

## Why (analytics findings, 2026-08-19 review)

- Approval-link funnel converts at 26% (92 minted → 24 approved, 7d). Timeline
  reconstruction shows the dominant failure is links that are **never opened**
  (e.g. one user minted 10 links over 2 days, zero `/dashboard/approve`
  pageviews) — an agent-relay failure, not link expiry. Every observed click
  happened 1–5 minutes after minting and approved successfully; exactly one
  user showed a possible expired-click. Fix direction: make the agent's job
  explicit in the denial copy, and instrument the link lifecycle so
  "never clicked" vs "clicked but failed" is measurable.
- A user retried `gmail_list` into the same Google 403 for two days with no
  successful call — Google auth errors carried no stop/re-auth guidance.
- Denial reasons exist only as prose; analytics can't split "create a sheet is
  unsupported" from "sheet not granted" (needed for the raw-API-create
  monitoring Ken requested).
- Legacy `mcp_tool_call` event: last seen 2026-08-17 (pre-PR#68 deploy
  stragglers). No emitter in source — nothing to retire in code.

## Changes

1. **Link lifecycle instrumentation** (uses the existing JWT `jti` as
   `link_id`):
   - `approvalLinks.ts`: `mintApprovalLink()` returns `{url, jti}`
     (`mintApprovalUrl` kept as wrapper); `peekApprovalToken()` decodes an
     (unverified) token for analytics-only jti/action on expired links.
   - `approval_link_minted` now carries `link_id` at all three mint sites.
     The send-denial flow now emits one event **per link** (actions
     `send_whitelist` / `send_all`, `via: 'send_denial'`) instead of a single
     `action: 'send'` event — minted counts for send denials roughly double;
     dashboards that count minted events should note the 2026-08-19 break.
   - New event `approval_link_opened` (approve page load) with
     `status: valid | expired | invalid` and `link_id` — closes the
     minted→opened→approved funnel.
   - `approval_link_approved` (all four paths) and magic-link
     `sheets_grant_verification` now carry `link_id`.
2. **Agent protocol in denial copy**: policy-denial and send-denial responses
   now instruct the agent to show the link to the user verbatim, NOT to retry
   until the user approves, and to mint a fresh link (retry the tool /
   `request_access`) if it expires unused.
3. **Google 401/403 re-auth nudges** (`describeGoogleError`): 401 and repeated
   403 now say to stop retrying and send the user to
   `/dashboard/accounts` to reconnect the Google account. (Sheets-path 403/404
   keeps its more specific picker-setup message.)
4. **Denial codes for analytics** (`denial_code` on `$mcp_tool_call`):
   - sheets policy: `sheets_not_exposed | sheets_blocked | sheets_read_only`
   - raw API policy: `raw_api_batch_unsupported | sheets_create_unsupported |
     gmail_write_unsupported | raw_api_not_exposed`
   - send policy: `recipients_undetermined | send_disabled |
     recipient_not_whitelisted`
   `sheets_create_unsupported` is the precise signal for the
   "created a sheet via raw API" monitoring insight.
5. **`list_accounts` onboarding nudge**: response gains `usage` and
   `add_accounts` fields — first-call examples, and the two real multi-account
   paths (Accounts → Accessible Gmail Accounts → Add for the user's own other
   mailboxes; Delegations You've Granted on the other person's dashboard for
   someone else's mailbox).

Out of scope (needs Ken's review of the error-card designs first): MCP
`structuredContent` error envelopes. The 401-handshake body nudge was
dropped — OAuth discovery is measurably working (`connector_install_started`
touchpoint data) and the handshake body is library-controlled.

## Validation

- `npx tsc --noEmit`
- Local QA of approve page + a denial flow via `/deploy-pr-preview` before
  merge; capability 12 (approval links) suite applies.
