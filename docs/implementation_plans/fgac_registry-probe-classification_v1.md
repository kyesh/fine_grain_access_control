# Registry probe classification — implementation plan v1

Branch: `fgac/registry-probe-classification` · 2026-09-10 · measurement only,
no schema change.

## Problem

FGAC's MCP server was listed on the official MCP Registry on 2026-09-10.
From 02:00Z a population of registry crawlers, health probes and "MCP
security" scanners began hitting `POST /api/mcp` with no token or a junk
bearer. In production PostHog:

| metric | 09-07 | 09-08 | 09-09 | 09-10 to 11:20Z |
| --- | --- | --- | --- | --- |
| `mcp_auth_attempt` no_token | 34 | 36 | 35 | 216 |
| `mcp_auth_attempt` invalid_token | 9 | 7 | 8 | 32 |
| 7.5 `direct_client_fingerprints` | 12 | 10 | 16 | 96 |

The invalid_token alert (insight mGzUClRs, >50/day) would trip on scanner
junk alone at that pace, and the acquisition-funnel query 7.5 had no crawler
exclusion despite saying fingerprints were "the right filter".

## What was established first (all from production data, 2026-09-10)

1. **Shape of the requests.** Of the 09-10 401s, 158 were unauthenticated
   `initialize` calls carrying a `clientInfo.name`, 32 bare POSTs, 21 GET,
   5 HEAD. Pre-launch days had ~20 initializes, ~11 bare POSTs (mostly our
   own auth probe, which sent Node's default `node` UA), 3–5 GET/HEAD.
2. **UA or client_name?** Both. Many crawlers self-describe in the UA
   (`SmitheryBot/1.0 (+https://smithery.ai)`), but a large minority run on a
   stock HTTP client (`node`, `undici`, `Go-http-client/2.0`, `python-httpx`,
   Deno on Supabase) and are only identifiable by the `initialize` name
   (`glama`, `verifymcp-probe`, `MCP-Marketplace-Scanner`). Either field alone
   misses about a third of the ~60 sources seen in nine hours.
3. **The invalid_token source.** Every one of the 28 non-probe invalid_token
   rows came from `python-httpx2/2.12.0` (not the real httpx UA) with
   `client_name = 'mcp'` — the Python MCP SDK's default name, so the name is
   not a tell; the UA prefix is. Pre-launch non-probe invalid_token was 0–2/day
   from real Clerk-instance tokens (`kid = ins_…`).
4. **The hourly floor.** 02Z 11 · 03Z 55 · 04Z 33 · 05Z 18 · 06Z 23 · 07Z 18 ·
   08Z 20 · 09Z 24 · 10Z 10. Eleven hours of data; the runbook says to
   re-verify over 48 h before moving thresholds.
5. **Scanners never authenticate.** No scanner client_name appears on
   `mcp_client_initialize`, `$mcp_tool_call`, `mcp_connection_*` or
   `mcp_transport_rejected` (the latter runs inside the auth layer). So 7.9,
   7.16 and 7.17 (the directory disconnect model, which counts Claude accounts
   that sent a message) are unaffected.
6. **PostHog's virtual bot properties don't help.** `$virt_is_bot` is `true`
   for every server-side event, including claude.ai's own installs, and
   `$virt_bot_name` is empty. Rejected.
7. **The alert insight had no probe filter.** Read via the API, insight
   11264607 carried only `environment` and `outcome` filters — the documented
   `kid != 'probe'` exclusion was never on it.
8. A `python-httpx/0.28.1` client self-reporting `client_name = 'Anthropic'`
   has sent ~6 tokenless initializes/day since at least 08-28 and never
   authenticated. Plausibly the Connector Directory's health check, or API
   `mcp_servers` calls without a token. Left unclassified (`direct`) and
   documented; it is a constant, not part of the delta.

## Changes

- `src/lib/mcpClientSignals.ts` — `classifyMcpClient({ userAgent, clientName })`
  → `client_class` ∈ `claude | internal | scanner | direct` plus
  `client_class_signal` (the rule that matched). Three layers: explicit
  names / UA prefixes for sources with no vocabulary; a whole-token vocabulary
  match on either field (`probe`, `scanner`, `crawler`, `health`, `registry`,
  `census`, …, `…Bot` suffix); the crawler self-link convention `(+https://…)`.
  Validated against 103 measured (UA, client_name) pairs incl. real clients
  that must stay `direct` (Cursor, MCP Inspector, Gemini CLI, browsers, curl).
- `src/app/api/mcp/route.ts` — stamps `user_agent`, `client_name`,
  `client_class`, `client_class_signal` on `mcp_auth_attempt` and
  `client_class`/`_signal` on `connector_install_started`.
- `.well-known` discovery routes — `client_class` (UA only) on the
  `oauth_discovery` touchpoint.
- `scripts/mcp-auth-probe.ts` — self-identifying `fgac-auth-probe/1` UA so the
  probe's no_token rows are `internal` instead of hiding under `node`.
  `kid='probe'` on its invalid_token rows is unchanged.
- `docs/monitoring.md` — section 1 props; alerts section corrected (stored
  filter finding, the two required filters, why); 7.5 excludes
  scanner/internal and adds `scanner_401s`; 7.9 and 7.17 notes; new 7.21
  (registry probe volume: baseline table, population, four queries, reading).
- `docs/analytics.md` — event catalog rows.
- Daily review task (`fgac-user-behavior-review`, local) — auth baseline now
  excludes the classes; new "registry probe volume" reading reported as
  traffic, with the two conditions that make it a flag.

## Not done / user actions

- **PostHog insight mGzUClRs**: add filters `kid is not probe` and
  `client_class is not scanner, internal`. The automation key has
  `query:read` only (`insight:write` denied on PATCH).
- Nothing blocks or rate-limits scanners — by design.
- Threshold stays 50/day; re-baseline only if 48 h of classed data says so.

## Validation

- `tsc --noEmit` clean; eslint clean on changed files; classifier check
  103/103.
- Preview: run the probe against the preview URL and send one request with a
  known scanner UA; confirm `mcp_auth_attempt` rows in PostHog
  (`environment = 'preview'`) carry `client_class = 'internal'` / `'scanner'`.
