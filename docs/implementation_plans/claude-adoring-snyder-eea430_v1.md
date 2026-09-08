# MCP handshake loops: what the client does, what the server pays, what to change

Branch: `claude/adoring-snyder-eea430` — revision 1 (2026-09-08)

## Finding (production PostHog, project FGAC.ai)

`mcp_client_initialize` rose 9x in ten days (336/day on 08-28 to 2,929/day on
09-07) while `$mcp_tool_call` stayed flat (1,010 to 1,436/day). Two Claude
Code clients account for the growth; everyone else is unchanged:

| day | claude-code clients with ≤10 initializes | 11–50 | >200 | initializes from the >200 clients | from the ≤50 clients |
| --- | --- | --- | --- | --- | --- |
| 08-28 | 51 | 6 | 0 | 0 | 336 |
| 09-03 | 58 | 11 | 1 | 2,179 | 480 |
| 09-07 | 59 | 18 | 2 | 2,276 | 599 |
| 09-08 | 57 | 16 | 2 | 866 | 563 |

(identifiers stay in local notes; the two clients hash to 85998 and 91939 in
the runbook query)

## 1. What the client is doing

Reconstructed from `mcp_client_initialize`, `mcp_auth_attempt`,
`mcp_transport_rejected` and `$mcp_tool_call` for the two heavy clients:

- **One OAuth client id per user** (each user's 7-day initializes come from a
  single `client_id`); nine `client_version`s over nine days on the top client
  (2.1.220 → 2.1.263), tracking Claude Code releases — an auto-updating
  install.
- **Two processes, not one.** On 09-07 the top client's 2.1.263 initializes
  (1,764) have a median gap of 29 s with 1,192 of them in the 20–40 s bucket —
  a fixed ~30 s timer; its 2.1.259 initializes (228) have a median gap of
  122 s and a wide spread. The two versions interleave hour by hour from
  11:00Z to 20:00Z. The second client shows the same shape at ~2 min
  (2.1.263, 28/hour all day) plus a 2.1.259 process during working hours.
- **Each cycle is a full client start-up, not a reconnect.** Sampled
  `mcp_auth_attempt ok` rows × 20 give ~3 authenticated POSTs per initialize
  (29,280 estimated requests against ~9,700 initializes over 7 days):
  `initialize`, `notifications/initialized`, `tools/list`. Zero GETs from
  either client — across all clients there was exactly one authenticated GET
  in 7 days (a different client), and the 93 unauthenticated GETs are
  scanners (`ado-p5-health/1`, curl, an old iPhone UA). **Claude Code never
  opens the optional SSE stream, so the stateless 405 on GET is never
  observed and cannot provoke anything.** Direction (d) is rejected on that
  evidence.
- **Tool calls are human-cadence bursts** (gmail_list/gmail_read/sheets at
  02Z, 07Z, 23Z) while the 30 s initialize stream runs through them — the
  loop is a background process next to normal interactive use.
- **`server/discover` probes: 341 over 4 days** (~1 per 28 initializes, i.e.
  the documented ~15-minute cadence). Claude Code 2.1.263 keeps an on-disk
  discovery cache (`~/.claude/mcp-discovery-cache`, env knobs
  `MCP_DISCOVERY_CACHE_TTL_S` / `_STRIKES` / `_MAX_STALE_S` found in the
  binary), which is why fresh processes do not re-probe every cycle. Also 95
  `sdk` rejections from the same clients: the same "Unsupported protocol
  version" 400 with no parseable method.
- **Claude Code behaviour (docs, via the claude-code-guide agent):**
  subagents share the parent's MCP connection; every `claude -p` invocation
  and every Agent SDK `query()` spawns a fresh CLI subprocess that
  initializes every configured MCP server (`startup()` pre-warms one
  subprocess for reuse — the loop shape means it is not being used);
  remote-MCP OAuth registrations live in the macOS Keychain and are shared
  by every process on the machine, hence one `client_id` for both versions.
  The bundled-CLI-in-the-SDK next to an auto-updating global `claude` is the
  simplest explanation of two versions interleaving from one registration.

Conclusion: an unattended headless loop (Agent SDK `query()` or `claude -p`
on a ~30 s timer) on the user's machine, with FGAC configured at user scope
so every spawn connects to it. Nothing on our side triggers it; nothing on
our side can stop it without rejecting the client, which is out of scope.

Local reproduction: `claude -p` against the dev server was attempted with
Claude Code 2.1.263 (fetched via `npx`, isolated from the native install)
but the CLI's own Claude login has expired on this machine ("OAuth session
expired and could not be refreshed") — the per-request cost measurement below
uses the MCP SDK's `StreamableHTTPClientTransport` (the transport Claude Code
embeds) with a QA-account bearer token instead.

## 2. What the eager `resolveConnection` costs

Per authenticated request (not just initialize — the auth wrapper runs it on
every verb): `users.findFirst`, `agentConnections.findFirst`, an
`UPDATE agent_connections SET last_used_at`, and `proxyKeys.findFirst` — four
sequential Neon HTTP round trips, one of them a write, whose result the auth
layer discards (tool handlers call `requireApproval` → `resolveConnection`
again). For the top client that is ~5,300 needless round trips a day; across
all clients ~85% of authenticated requests are handshake traffic.
Measured locally (dev server → Neon branch; see revision 2 for numbers).

## 3. PostHog volume

Project total is ~4.5–6k events/day (~170k/month) against the 1M/month free
tier; `mcp_client_initialize` is 40–55% of it. Not a plan problem today
(~6% of the tier from handshakes), but it is the largest event and the trend
is driven by a pattern that will recur as Agent SDK loops spread. Coalescing
keeps counts reconstructible while removing the volume.

## Decision on the candidate directions

| direction | verdict | evidence |
| --- | --- | --- |
| (a) document + named query + threshold | **accept** | daily review re-derived this three times; runbook 7.15 |
| (b) skip the DB touch within N minutes | **accept** | result unused for authorization; 4 round trips × ~9k requests/day |
| (c) coalesce `mcp_client_initialize` | **accept, with reconstructible counts** | largest event; `coalesced_initializes` keeps `sum(1 + n)` exact per instance window; first-per-instance capture and the DB-driven name backfill keep `mcp_connection_client_identified` semantics |
| (d) fix GET/405 or session handling | **reject** | no GETs from Claude Code in production at all |

## Change

- `src/lib/connectionTouchMemo.ts` — bounded LRU (500) keyed by
  `userId clientId`, 5-minute window. `shouldSkipEagerResolve` never skips an
  `initialize` until the row carries a real product name (`named`), so the
  backfill one-shot still fires. `coalesceInitialize` captures the first
  initialize an instance sees and every one after the window, returning the
  suppressed count for the event. Per instance; cold starts run the full path.
- `src/app/api/mcp/route.ts` — auth layer consults the memo before the eager
  resolve, records the outcome, and captures `mcp_client_initialize` with
  `coalesced_initializes`. `mcp_auth_attempt` gains `connection_resolve`
  (`ran`/`skipped`/`error`) and `connection_resolve_ms` (captured after the
  resolve now; sampling unchanged). Kill switch
  `MCP_CONNECTION_TOUCH_MEMO=disabled`.
- `scripts/test-connection-touch-memo.ts` in `npm run mcp:lint`.
- Docs: `docs/analytics.md` (event semantics), `docs/monitoring.md` §1
  (new properties) and §7.15 (named queries, threshold, health reading).

Behavioural consequences, stated: dashboard "Last used" may lag by up to 5
minutes for a continuously active client; a connection the user deletes from
the dashboard while its client is mid-window is recreated by the client's
next tool call or by the next request after the window, not by the very
next handshake.

## Validation

1. `npm run mcp:lint` (unit test) and `npx tsc --noEmit`.
2. Local: N handshake cycles with the SDK transport against the dev server;
   expect the trace to show `resolve` running on cycle 0 and `skipped` after,
   one `mcp_client_initialize` capture per window.
3. Preview (`/deploy-pr-preview`): same cycles against the preview URL, then
   the two §7.15 queries with `environment = 'preview'`.
4. Production, day after deploy: §7.15 — `skipped` share of sampled `ok`
   rows high, `mcp_client_initialize` rows/day well under 2,000 with
   `sum(1 + coalesced_initializes)` still matching the loop clients' cadence.
