# Sheets tool-call timeout observability

Branch: `claude/sheets-tool-timeout-errors-82e433`

## Problem

A user (new account, 2026-08-27) reported timeout errors on Google Sheets MCP
tool calls. Investigation found **zero server-side trace**: all 94 of the
account's `$mcp_tool_call` events that day were fast successes (p95 1.9 s),
no auth failures, no token failures. The timeouts were unobservable because:

1. `googleFetch` had no timeout — a hung Google call rode into the route's
   60 s `maxDuration`, and the Vercel kill destroys the PostHog capture too
   (`$mcp_tool_call` fires on handler completion; flush runs in `after()`).
2. Vercel CLI runtime logs retain only ~100 entries (~35 min) — gone by the
   time a user reports "earlier today".
3. `$mcp_duration_ms` is one opaque number — Google-time vs FGAC-time
   (token fetch, rules, DB) was not separable.

Production data confirms the failure mode is real: on 2026-08-23,
21:00–22:00 UTC, one user's `sheets_read_range` calls stalled in batches at
42–59 s and then **succeeded** (worst: 58.8 s against the 60 s kill —
survivor bias implies slower calls were killed invisibly).

## Change (this revision)

All in `src/app/api/mcp/route.ts` + docs:

1. **`GOOGLE_FETCH_TIMEOUT_MS = 50_000`** — `AbortSignal.timeout` on the
   `googleFetch` fetch, covering headers *and* body streaming. On abort:
   `error_status: 'timeout'` + agent-facing text that distinguishes reads
   (retry once) from writes (verify before retrying — the write may have
   landed). 50 s, not 25 s: every tool's 30-day p99 is ≤ ~13 s, but the
   Aug 23 brownout recoveries ran 42–59 s; the bound must sit above the
   recovery band and below the 60 s kill.
2. **`CLERK_TOKEN_TIMEOUT_MS = 15_000`** — `withTimeout` wrapper on the MCP
   path's `getUserOauthAccessToken`; timeout classifies as
   `reason: 'timeout'` on `google_token_fetch_failed` and
   `google_token_error: 'timeout'` on the tool-call event.
3. **Phase timings** — `google_ms` (cumulative across grace retries, via
   `recordGoogleMs`) and `token_ms` stamped on `$mcp_tool_call`, so
   "was Google slow?" is answerable per call.
4. Docs: `docs/analytics.md` property tables + a new "Upstream timeout
   classification" section.

## Out of scope / follow-ups

- The proxy path (`/api/proxy/[...path]`) has the same unbounded-fetch blind
  spot (`fetchClerkGoogleToken` + its Google fetches) — same treatment,
  separate change.
- Durable request logs (Vercel log drain) — would catch pre-handler deaths
  (cold start, auth, transport) that no in-handler telemetry can.

## Validation

- `tsc` / lint clean.
- Local: dev server + a normal sheets call still succeeds (timeout path is
  not reachable without a stalled upstream; classification logic is
  branch-reviewed).
- Post-deploy: `error_status = 'timeout'` becomes a queryable class in
  PostHog; `google_ms` appears on new `$mcp_tool_call` events.
