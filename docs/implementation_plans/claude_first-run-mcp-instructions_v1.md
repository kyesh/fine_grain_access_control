# First-run MCP instructions + connection client attribution fix

Branch: `claude/first-run-mcp-instructions` — v1 (2026-08-29)

## Why (investigation summary, PostHog project FGAC.ai, production, 14d ending 2026-08-29)

Re-verified headline: **135 persons** created an `mcp_connection_created`; **73 (54%)
had zero successful tool calls** in the window — 63 made no tool call at all, 10
called and never succeeded. Splitting the 63 zero-call connectors:

- **Every zero-call person observable since client instrumentation shipped
  (2026-08-28) completed the `initialize` handshake.** The apparent "no handshake"
  bucket (27 people) is entirely pre-instrumentation (`last_seen` ≤ 08-27) — an
  artifact, not a population. The "client config never initializes" hypothesis is
  rejected: the 4 silent claude-code users initialized up to 14 times.
- **Claude.ai web dominates 8:1** (32 ClaudeAI vs 4 claude-code zero-callers), most
  with several initializes across days — the connector is live in their sessions
  repeatedly and no tool call ever happens. Fix must live in the surface those
  sessions actually load: the `initialize` response.
- **54 of 63 never loaded a single fgac.ai page** (no `$pageview` at all; 0
  rageclicks; all 63 signed up in-window with `account_age_seconds ≈ 0`). The
  connection IS the signup; there is no dashboard journey to fix.
- **Trend (corrected weekly cohorts):** launch week 08-16: 113 connectors, 37%
  active within 7d; week 08-23: 22 connectors, 68% active. The 51–54% silent rate
  is dominated by the directory-launch cohort; steady state is ~1/3 and improving.
  (Methodology note: the naive HogQL cohort join inflates activation — ClickHouse
  LEFT JOIN fills unmatched timestamps with the 1970 epoch, not NULL; guard with
  `first_ok > toDateTime('2000-01-01')`.)
- Error-path (10 called-never-succeeded): 4 people stuck at `denied_by_policy` on
  `sheets_get_spreadsheet` (up to 13 retries), rest scattered one-off upstream
  errors. Secondary to the silent cohort; the sheets grant funnel is a separate
  known workstream.
- **Telemetry bug found:** `client_name` never lands on `mcp_connection_created`
  (0/10 events since 08-27) despite PR #90's intent. Root cause: the connection
  row is created by the first *authenticated* request, and that is in practice the
  client's concurrent SSE GET (no body → no clientInfo), not the initialize POST;
  the later initialize backfills the DB row's name but no event ever carries it.

## Changes

1. **`initialize` instructions rewrite** (`src/app/api/mcp/route.ts`): prepend a
   first-run/anti-refusal preamble — live access framing, "use these tools instead
   of claiming no access", and `list_accounts` as the first call with a suggested
   first demonstration. The existing content QA capability 10 A10 asserts on
   (typed-shortcut map, `google_api_get`/`google_api_modify` fallback, denial →
   approval-link pattern) is preserved verbatim after the preamble. Rationale:
   this string is the only server-controlled surface that reaches the dominant
   silent cohort (handshake happens; tool results never do).
2. **`mcp_connection_client_identified` event** (same file, backfill-on-touch
   path): fires once per connection when the first initialize replaces the opaque
   `client_id` placeholder name — restores a reliable connection→client-product
   mapping without changing `mcp_connection_created` timing/semantics.
3. **`docs/analytics.md`**: event-table rows + `client_name` section updated to
   document the nameless-creation reality and the new event.

## Success measure

7d-activation share of new connectors (weekly cohort query with the epoch guard
above), and per-product zero-call share via `mcp_client_initialize` persons vs
`$mcp_tool_call outcome='success'` persons. Baseline 08-23 week: 68% active in 7d.
New-event verification: `mcp_connection_client_identified` count > 0 within a day
of deploy, `client_name` distribution matching `mcp_client_initialize`'s.

## Explicitly rejected on evidence

- Claude Code install-flow breakage post-OAuth (SHIP direction 2): no evidence —
  silent claude-code users handshake fine and number only 4.
- Dashboard/web UX fixes for this cohort: 86% never load a page.
- Outbound email nudges: deferred per Ken's product-surface-first preference;
  nothing here changes that.
