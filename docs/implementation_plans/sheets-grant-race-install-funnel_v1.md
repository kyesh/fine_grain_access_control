# Sheets grant-race fixes + connector install-funnel measurement — v1

Branch: `claude/sheets-grant-race-install-funnel`

## Problem

PostHog timeline analysis (2026-08-18) of the post-PR#71 Sheets errors showed two residual
failure shapes, plus a measurement blind spot at the very top of the connector funnel:

1. **Grant-propagation race.** Google's per-file `drive.file` grant is eventually
   consistent. Even though the picker-first approval verifies the grant with the owner's
   token before creating rules, the agent's next MCP call can still 403/404 for
   ~10–60 s (observed: one error immediately post-approval, success seconds later, for
   three separate users; one user's MCP path 403'd five minutes after the dashboard-side
   verify passed).
2. **No error detail.** `$mcp_tool_call` failures carry only `outcome='error'` — no HTTP
   status, no grant age. Diagnosis required event-timeline archaeology.
3. **Invisible pre-auth funnel.** The Claude connector flow authenticates on Clerk's
   hosted pages; people who click "Add connector" but never finish Clerk sign-up leave
   zero events anywhere. We cannot even estimate that abandonment rate.

## Changes

### Fix 1 — settle the grant before telling the user "retry now"

- `approveMagicLink` (src/app/dashboard/actions.ts) returns the granted spreadsheet id
  (`grantedSpreadsheetId`) on successful sheets approvals.
- The approve page's success redirect carries `&sid=` for sheets approvals; the
  `result=ok` card becomes a client component (`ApprovedSettling`) that polls
  `GET /api/rules/verify-sheets-access?sid=…&context=post_approval` every 2 s (max 15 s):
  - verifying → "Approved — confirming Google has finished sharing the sheet…"
  - `ok` → "✓ Approved & verified with Google. The agent can retry now."
  - timeout/`missing` → approved-but-unconfirmed note linking to
    `/dashboard/sheets-setup?sid=…` (the existing recovery loop).
- `verify-sheets-access` captures `sheets_grant_verification` with `via: 'post_approval'`
  for this context, mirroring the existing `link_open` capture.

Net effect: the user stays on the page through most of the propagation window and is
never told "retry now" on an unconfirmed grant.

### Fix 2 — server-side grace retry on fresh 403/404 (the load-bearing fix)

- `checkSheetsPermission` (src/app/api/mcp/route.ts) additionally returns
  `newestRuleAt` — the max `createdAt` of the rules that matched the spreadsheet.
- New `sheetsFetchWithGrace(...)`: runs `sheetsFetch`; when the result is 403/404 AND the
  matching rule is younger than 120 s, waits 3.5 s and retries, up to 2 times, before
  returning the failure. Applied to all five `sheets_*` tools and the raw
  `google_api_*` sheets path.
- `export const maxDuration = 60` on the MCP route so the added ≤7 s cannot hit the
  function timeout.
- Retry attempts are recorded on the analytics event (`sheets_grace_retries`).

Net effect: an agent that retries (or first-calls) inside the propagation window gets a
slightly slower success instead of an error. Outside the 120 s window behavior is
unchanged — a genuine missing grant still errors immediately with the setup-page message.

### Fix 3 — error detail on tool-call analytics

- `googleFetch` records `error_status` (HTTP status, or `'network'`) into the tool-call
  AsyncLocalStorage bag on every non-OK Google response → rides into `$mcp_tool_call`.
- `sheetsFetchWithGrace` records `sheets_grant_age_seconds` (age of the newest matching
  rule) on sheets failures, and `sheets_grace_retries` when retries ran.

### Option 1 — connector install-funnel measurement (pre-Clerk)

Two FGAC-owned touchpoints exist before any Clerk account: the OAuth discovery
endpoints and the unauthenticated MCP request that triggers the 401 + WWW-Authenticate
handshake. Both now capture an anonymous server event `connector_install_started`
(distinct_id `anonymous-mcp`, already excluded from user metrics):

- `.well-known/oauth-protected-resource/mcp` and `.well-known/oauth-authorization-server`
  GETs → `{ touchpoint: 'oauth_discovery', endpoint, user_agent }`.
- MCP request with missing/invalid bearer → `{ touchpoint: 'mcp_401',
  reason: 'no_token' | 'invalid_token', user_agent, method }`.

Interpretation notes (documented in docs/analytics.md): this is a **rate** metric, not an
identity metric. `reason='no_token'` on POST approximates fresh install attempts;
`invalid_token` is mostly expiry/refresh noise; discovery fetches recur on
reconnects. Compare daily `no_token` POST volume against `mcp_connection_created` to
estimate Clerk-step abandonment.

## Explicitly out of scope

Self-hosting the Clerk sign-in page (separate investigation, running in parallel);
no-auth demo toolset (needs a product spike).

## Test plan

- `npm run build` + `npx tsc --noEmit` + lint clean.
- Local dev server, dev Neon branch, dev Clerk:
  - Discovery endpoints return unchanged JSON; `connector_install_started` appears in
    PostHog with `environment='development'`.
  - Unauthenticated `POST /api/mcp` still returns 401 + WWW-Authenticate; event fires.
  - Authenticated MCP call (QA account) unchanged; no stray install events.
  - Sheets approval flow end-to-end via browser (QA account): deny → link → picker →
    approve → settling state → verified card. Rules created identically to before.
  - Sheets tool call with fresh rule: force a 404 (wrong id) → confirm no grace retry
    for old rules, grace retry engages only for fresh rules (observable via event props
    and server logs).
  - Gmail read/list flows unchanged (error_status only added on failures).
- Preview: /deploy-pr-preview, re-run discovery + 401 checks against the preview URL,
  run the applicable QA_Acceptance_Test sheets capability.

## Rollback

All changes are additive (new event, new props, retry-on-failure path, settling UI on
top of the existing ok card). Revert the branch; no schema or data migrations.
