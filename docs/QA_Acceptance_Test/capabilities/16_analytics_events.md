# Capability: Analytics Events (PostHog)

> Asserts that product analytics actually arrive in PostHog with the canonical
> schema (`docs/analytics.md`). Exists to catch regressions like the 2026-08
> incident where MCP tool calls were captured under the legacy `mcp_tool_call`
> name, so PostHog's MCP views showed "MCP tool call (legacy)" with no tool name.

## How to query

Preferred: the session's **PostHog MCP connector** (decision 2026-08-23 —
option 2 of the key-provisioning discussion on PR #78). Runners inherit the
session's MCP connections: load the tool via ToolSearch (keyword `posthog
exec`; the server prefix is a connector UUID, so never hardcode the full tool
name) and run read-only HogQL via `call execute-sql {"query": …}`. The
`qa-env-runner` agent definition allowlists this tool. Cite "via PostHog MCP"
in evidence.

Fallback: `npx tsx scripts/qa-posthog-events.ts` (read-only HogQL probe; see
its header for flags). It requires `POSTHOG_PERSONAL_API_KEY` (Query:Read
scope) and `POSTHOG_PROJECT_ID` in the environment or `.env.local` — **these
are deliberately unprovisioned as of 2026-08-23**; the script becomes the
primary path for cloud/CI sessions only if Ken provisions the keys later.

Prerequisites and caveats:

- If NEITHER path is available (ToolSearch finds no PostHog tool — possible in
  cloud/CI sessions where the interactively-authenticated connector is absent,
  and the keys are unprovisioned), every assertion below is a `skip` with
  reason "no PostHog query path in this session" — never a pass.
- All three Vercel environments share one PostHog project. **Always filter on
  the `environment` property** matching the deployment under test:
  `development` (localhost), `preview` (`*.vercel.app`), `production`.
- Ingestion lags ~30–60s. Re-query at least twice over ~2 minutes before
  calling an expected event missing.
- Evidence masking: the script truncates distinct ids; never paste a full Clerk
  user id, email, or key into qa-results.json or anything public.

## Assertions

Run these AFTER the environment's other capabilities (they generate the tool
calls under inspection). Use `--since` spanning the run so counts are
attributable to it.

### A8: Response-size monitoring props on every tool call
- Inspect `$mcp_tool_call` events across services (gmail, sheets, docs tools)
  from this run.
- **Expected**: Every event carries `response_chars` and `response_kb`
  (monitoring-only — plan google-docs-support v5, D7: no size caps are
  enforced; the props exist so PostHog can measure how often responses exceed
  MCP clients' tool-result budgets). `gmail_get_attachment` additionally
  carries `attachment_chars`/`attachment_kb` on every outcome that reaches
  the attachment fetch, including the over-cap ⚠️ refusal — which since
  2026-08-24 classifies as `outcome=size_capped`, not `failed` (first shipped
  with the raw-api-classification change — earlier docs described these props
  ahead of the code). Events whose attachment fetch itself failed carry
  `attachment_declared_kb` (size from the parent's MIME metadata) instead.
  Windowed attachment reads add `attachment_mode` / `attachment_offset` /
  `attachment_window` / `attachment_text_kind` / `attachment_text_chars` /
  `attachment_extract_error` — asserted in capability 20 (A7), not re-checked
  here.

### A9: Raw Google API calls carry product/action classification
- Inspect `$mcp_tool_call` events where `$mcp_tool_name` is `google_api_get`
  or `google_api_modify` from this run (capability 10 generates them: a raw
  Gmail read, a raw Sheets call, and an unknown-family passthrough).
- **Expected**: every such event carries `raw_api_kind` (one of `sheets`,
  `sheets_create`, `docs`, `docs_create`, `gmail_read`, `gmail_send`,
  `gmail_draft_send`, `gmail_write`, `passthrough`, `denied`),
  `raw_api_mutating`, and `raw_api_endpoint` whose
  value is the HTTP method plus an **id-stripped** path template — it must
  contain `{id}`/`{range}` placeholders where the call used real identifiers
  and must NOT contain any actual spreadsheet/message/document id.
  `raw_api_family` is present on every non-denied event (`gmail`,
  `spreadsheets`, `documents`, or the passthrough family); denied events
  carry `denial_code` instead.

### A10: Google failure reason and account-resolution reason are recorded
- Inspect `$mcp_tool_call` events from this run whose `outcome` is `error` or
  `failed`.
- **Expected**:
  - Every `outcome=error` event carries `error_status`. Events whose Google
    response body included an error reason additionally carry `error_reason`
    (Google's `error.errors[0].reason`, e.g. `rateLimitExceeded`,
    `insufficientPermissions`, `domainPolicy`) and, when present,
    `error_domain` (e.g. `usageLimits`). Absent reasons are legitimate — some
    Google errors carry no `errors[]` — so assert "present when the body had
    one", not "always present".
  - No `error_reason` / `error_domain` value contains an email, message id,
    spreadsheet id, or any other identifier: these must only ever be Google's
    enum strings.
  - Every `outcome=failed` event produced by account/token resolution carries
    `failure_reason`, one of `no_proxy_key`, `no_accessible_accounts`,
    `account_not_permitted`, `google_token_unavailable`. Capability 03
    (multi-email scoping) and 07 (key lifecycle) generate the
    `account_not_permitted` and `no_proxy_key` cases respectively.
  - `outcome=failed` events must still have `$mcp_is_error = false`. These
    are deliberately `textResult`, not `errorResult` — promoting them would
    move them into the error field Anthropic's Connector Directory reads. A
    run where `$mcp_is_error` is true for a `failed` outcome is a regression,
    not a pass.
  - A `gmail_get_attachment` or `gmail_read` event with `error_status = 404`
    carries `gmail_404_site` (`message` or `attachment`). `attachment` means
    the parent message read succeeded and only the attachment id was stale.

> **Runnable via the PostHog MCP connector** (load with `ToolSearch "posthog
> exec"`), which is how the 2026-08-26 baseline below was measured. The
> `scripts/qa-posthog-events.ts` path still needs `POSTHOG_PERSONAL_API_KEY`
> (`phx_…`, Query:Read) in `.env.local`, and the `.mcp.json` server still
> needs it in the shell env — `npm run env:check` reports both gaps. Use the
> connector when the script path is unprovisioned; record `blocked` only if
> neither is available.
>
> A10 does NOT require a production deploy. `captureServerEvent` tags
> `environment: process.env.VERCEL_ENV ?? 'development'`, so a local
> `npm run dev:qa` run emits these events under `environment='development'`
> and a preview deploy under `'preview'`. Run it per tier.
>
> **Executed locally 2026-08-27** against a real Clerk OAuth MCP session
> (`scripts/qa-dcr-setup.ts` → consent as USER_A → bearer token → `tools/call`).
> Confirmed present on `environment='development'` events:
>
> | property | observed value | on |
> | --- | --- | --- |
> | `error_reason` / `error_domain` | `notFound` / `global` | 404s |
> | `error_reason` / `error_domain` | `invalidArgument` / `global` | 400s |
> | `gmail_404_site` | `message` | `gmail_read` and `gmail_get_attachment` |
> | `failure_reason` | `account_not_permitted` | `gmail_list` |
> | `failure_reason` | `google_token_unavailable` | `gmail_list` |
>
> Both `failed` rows carried `$mcp_is_error = false`, confirming the
> textResult/errorResult decision holds at runtime. No property value
> contained an identifier.
>
> **NOT covered by that run, and still open:**
> - `gmail_404_site = 'attachment'` could not be produced synthetically (see
>   the Gmail 400-vs-404 note below).
> - `error_reason` on a 403 — no 403 could be induced on demand.
> - `failure_reason` of `no_proxy_key` / `no_accessible_accounts` — these need
>   capability 07 / 03 setup states.
>
> **Gmail returns 400, not 404, for a malformed id** (verified 2026-08-27):
> a non-hex `messageId` gives `400 Invalid id value`, and a tampered
> `attachmentId` gives `400 Invalid attachment token` — attachment ids are
> signed tokens, so corruption fails validation rather than lookup. A valid
> attachment token also still resolved when passed with a *different*
> `messageId`. Consequence for triage: the production
> `gmail_get_attachment` 404s cannot be fabricated or corrupted ids — they
> must be well-formed, previously-valid ids that no longer resolve, which is
> exactly the stale-id case the `attachment` remediation targets.
>
> Pre-deploy production baseline to compare against (2026-08-26): Gmail
> failures are 68 404s (38 `gmail_get_attachment`, 30 `gmail_read`), 19 403s,
> and 39 statusless `failed` calls. After deploy those 404s must carry
> `gmail_404_site` and those statusless calls must carry `failure_reason`; if
> they do not, the instrumentation regressed.

### A1: Canonical tool-call events arrive with tool names
- Run: `npx tsx scripts/qa-posthog-events.ts --event '$mcp_tool_call' --since <run window> --environment <tier>`
- **Expected**: `row_count` ≥ the number of MCP tool calls this run made;
  `missing_tool_name` is 0; `by_tool` lists the tools actually called
  (e.g. `gmail_send`, `get_my_permissions`) with plausible counts

### A2: No legacy-named events are emitted
- Run the same query with `--event mcp_tool_call` (legacy name, no `$`)
- **Expected**: `row_count` is 0 for the run window in this environment —
  nothing in the deployed code still captures the legacy event

### A3: Outcome taxonomy is recorded
- Inspect `by_outcome` from A1 (ensure the run included at least one allowed
  call and one policy-denied call, e.g. capability 01 A1 + A2)
- **Expected**: at least one `success` and at least one `denied_by_policy`;
  every outcome value is within {success, denied_by_policy, pending_approval,
  size_capped, failed, error, exception}

### A4: Events attribute to the Clerk user, not anonymous
- Inspect `rows[].distinct_id` from A1
- **Expected**: rows from this run's authenticated calls have a Clerk-style
  distinct id (masked, `user_…` prefix) — the same person the dashboard
  identifies — and none attribute to `anonymous-mcp`

### A5: Environment tagging matches the deployment tier
- Compare A1 run with and without the `--environment` filter over the run window
- **Expected**: every row from this run carries the correct `environment` value
  for the base URL under test (localhost → `development`, `*.vercel.app` →
  `preview`, `fgac.ai` → `production`); the filtered and unfiltered counts of
  this run's events match

### A6: Sign-up CTA event fires (browser environments)
- Signed out, load the landing page and click a sign-up CTA (do NOT complete
  sign-up — never create accounts); then
  `npx tsx scripts/qa-posthog-events.ts --event sign_up_started --since 10 --environment <tier>`
- **Expected**: ≥ 1 row with `cta_location` ∈ {nav, hero, bottom_cta}.
  Headless environments (no browser) `skip` with that reason.
  (`sign_up_completed` is deliberately untested — it requires creating a real
  account, which QA never does; it is validated implicitly by the Clerk
  webhook's own tests.)

### A7: Demo video play event fires (browser environments)
- Load the landing page and start playback on one of the Descript demo
  embeds — click its play control; if the embed ignores automated clicks,
  trigger playback from the page console instead
  (`document.querySelector('iframe[src*="share.descript.com"]').contentWindow.postMessage(JSON.stringify({context:'player.js',version:'0.0.11',method:'play'}),'*')`
  — this still exercises FGAC's listener + capture path end-to-end); then
  `npx tsx scripts/qa-posthog-events.ts --event video_played --since 10 --environment <tier>`
- **Expected**: ≥ 1 row whose `video_id` matches the embed and whose `page`
  is `/` (or the use-case page); exactly one event per video per page load
  regardless of subsequent pause/resume. Headless environments `skip`.

### A14: The approval funnel joins on a deterministic request_id
- Trigger the same denial three times (capability 14 A12), then approve the
  link once. Query the three approval events for the affected user:
  `SELECT event, properties.request_id, properties.action, count() FROM events
   WHERE event LIKE 'approval_link_%' AND timestamp >= now() - INTERVAL 1 HOUR
   GROUP BY 1,2,3`
- **Expected**: All three mint attempts carry the **same** `request_id`, and
  the `approval_link_opened` / `approval_link_approved` rows carry that same
  id — a single request joins across all three stages. `uniq(request_id)` = 1
  while `count()` on minted = 3
- **Regression**: before 2026-08-25 `link_id` was a per-mint JWT `jti`, so
  retries were indistinguishable from fresh demand. That is what made a funnel
  converting near 58% report as 31%

### A11: Mint events count attempts, not requests
- From the same three denials, inspect `mint_count` on the minted events and
  the `approval_requests` row
- **Expected**: `approval_link_minted` fires **once per attempt** (3 events),
  and the `approval_requests` row for that `request_id` has `mint_count` = 3
  with one `first_minted_at`. Demand (rows) stays separable from retry
  pressure (`mint_count`) — a funnel that collapses retries into one event
  would lose the retry signal entirely

### A12: Approval events carry no raw customer identifiers
- Inspect the properties of every `approval_link_*` event from the run
- **Expected**: `target_hash` is present for targeted actions and is a hash —
  it must NOT equal, contain, or reveal the spreadsheet id, document id, or
  recipient address. No raw file id, recipient address, or FGAC user id
  appears in any approval-event property, and none appears in the approval URL

### A13: Approve-page opens distinguish agents from people
- Open an approval link in the browser, then fetch the same URL with a
  non-browser user agent (an authenticated agent-style client)
- **Expected**: Both produce `approval_link_opened`; the browser open has
  `agent_driven: false` and the agent-style fetch has `agent_driven: true`
- **Why**: the event is captured server-side and carries no browser UA of its
  own, so every open previously looked identical. ~23% of production
  approve-page loads were an AI agent rather than a person, which meant
  "opened" systematically overstated human reach. Report approvals, not opens
