# Capability: Analytics Events (PostHog)

> Asserts that product analytics actually arrive in PostHog with the canonical
> schema (`docs/analytics.md`). Exists to catch regressions like the 2026-08
> incident where MCP tool calls were captured under the legacy `mcp_tool_call`
> name, so PostHog's MCP views showed "MCP tool call (legacy)" with no tool name.

## How to query

Preferred: `npx tsx scripts/qa-posthog-events.ts` (read-only HogQL probe; see
its header for flags). If the PostHog MCP server is connected (`.mcp.json`
`posthog` entry — needs `POSTHOG_PERSONAL_API_KEY` exported), an equivalent
event/HogQL query through it is acceptable; cite which path was used.

Prerequisites and caveats:

- `POSTHOG_PERSONAL_API_KEY` (Query:Read scope) and `POSTHOG_PROJECT_ID` must be
  in the environment or `.env.local`. If absent, every assertion below is a
  `skip` with reason "PostHog query credentials not provisioned" — never a pass.
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
  failed, error, exception}

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

### A8: Non-success outcomes carry a reason and a diagnostic message
- Re-run the A1 query over the run window, selecting `outcome`,
  `properties.outcome_reason`, and `properties.result_message` for rows where
  `outcome != 'success'` (ensure the run included at least one policy-denied
  call, e.g. capability 01 A2, and one sheets denial, e.g. capability 09's
  unexposed-sheet case)
- **Expected**: policy-denial and upstream-failure rows carry a snake_case
  `outcome_reason` (e.g. `send_not_whitelisted`, `sheets_not_exposed`,
  `sheets_grant_missing`, `connection_pending_approval`, `google_404`); every
  non-success row carries a `result_message` that contains NO `http`/`https`
  URL (signed approval links must be stripped) and is ≤ 200 chars
