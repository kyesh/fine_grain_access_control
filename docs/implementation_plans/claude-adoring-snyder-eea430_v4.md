# MCP handshake loops — revision 4: real Claude Code reproduction

Branch: `claude/adoring-snyder-eea430` — revision 4 (2026-09-09). PR #124.
Closes the loose end in v1–v3: the CLI login was renewed, so the
reproduction ran with the real Claude Code 2.1.263 binary (fetched via
`npx`, isolated from the native install) against the local dev server.

## Setup

An OAuth-registered entry could not be used: the CLI keys stored MCP tokens
by server *name*, so reusing the user's `fgac-gmail` entry against a
different port answered 401 once and then marked that entry needs-auth in
`~/.claude/mcp-needs-auth-cache.json` (the entry was removed again by hand).
Instead a QA-account bearer minted by the runner was passed as a static
`headers.Authorization` in an `--mcp-config` file under a fresh server name,
with `--strict-mcp-config` so nothing else connected.

## Headless: `claude -p`, two consecutive runs

Identical request sequence both times, one process each:

| # | request | status | meaning |
| --- | --- | --- | --- |
| 1 | POST `server/discover` | 400 | protocol-version probe (`discover_probe`) |
| 2 | POST `initialize` | 200 | |
| 3 | POST `notifications/initialized` | 202 | |
| 4 | GET | 405 | optional SSE stream; taken quietly, no retry |
| 5 | POST `tools/list` | 200 | process exits after the model replies |

Five authenticated requests per start, no prompts/list or resources/list.
Both runs probed, so the discovery cache did not suppress the probe for a
fresh server entry; production's loop clients probe only about once per 28
initializes, consistent with a strikes-based cache that engages after
repeated legacy verdicts.

Two corrections to earlier revisions follow from this:

- v1/v3 said Claude Code "never opens the SSE GET". A real CLI start does
  send one GET and accepts the 405 without reconnecting. The production loop
  clients still show no authenticated GETs, so their per-start cost is the
  three POSTs; the direction-(d) verdict (nothing to fix in GET/405 handling)
  stands, on stronger evidence: the 405 is observed and causes nothing.
- The probe is an authenticated request too, so before the memo it also ran
  the four-query eager resolve.

## Interactive: idle session

A `claude` interactive session with the same config, started from the
trusted worktree directory and left idle, issued the same five requests at
start and **nothing else for 5.5 minutes**. There is no periodic
re-initialize, keepalive or reconnect in 2.1.263 for a stateless HTTP
server. The ~30 s production cadence can only come from repeated process
starts.

## Effect of the memo on this shape

With the memo on, each of the five requests still authenticates, but only the
first request per user+client per instance in a 5-minute window runs the
eager resolve; the initialize telemetry is captured once per window. For a
process-per-30-seconds loop that is a 10x reduction in DB touches and
initialize rows per warm instance, with the count still reconstructible.

## Validation status

- [x] `npm run mcp:lint`, `npx tsc --noEmit`
- [x] local and preview cycles (v2, v3)
- [x] real Claude Code 2.1.263 headless and interactive reproduction (above)
- [ ] production, day after deploy: `docs/monitoring.md` §7.15
