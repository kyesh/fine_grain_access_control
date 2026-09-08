# MCP handshake loops — revision 2: local measurements

Branch: `claude/adoring-snyder-eea430` — revision 2 (2026-09-08). Supersedes
v1's "see revision 2 for numbers"; everything else in v1 stands.

## How it was measured

The CLI reproduction (`npx @anthropic-ai/claude-code@2.1.263 -p …
--mcp-config` against the dev server) is blocked on this machine: the CLI's
own Claude login is expired ("OAuth session expired and could not be
refreshed"; `claude login` is a user action). Instead a scratchpad script
drove the MCP SDK's `StreamableHTTPClientTransport` — the transport Claude
Code embeds — through Claude Code's start-up shape N times: `initialize`,
`notifications/initialized`, `tools/list`, close. A QA-account bearer token
for the local server was minted by the `qa-setup-driver` runner (DCR + PKCE
+ trusted-click consent; the flow works unchanged on a non-3000 port). The
dev server carried temporary per-request tracing (RPC method, client
name/version, eager-resolve wall time, and a Drizzle query logger); the
tracing was removed before commit.

One difference from Claude Code surfaced immediately: the stock SDK
transport opens the optional SSE stream with a GET after
`notifications/initialized` (and takes our 405 quietly), so a stock-SDK cycle
is four authenticated requests. Production shows Claude Code sends no GET at
all (one authenticated GET in 7 days across every client, from a different
client id), so Claude Code's cycle is three.

## Baseline: memo off (`connectionTouchMemoEnabled` forced false)

Every authenticated request — initialize, the initialized notification, the
GET, tools/list — ran exactly the same four Neon queries in the auth layer:

```
select … from "users" where clerk_user_id = $1
select … from "agent_connections" where user_id = $1 and client_id = $2
update "agent_connections" set "last_used_at" = $1 where id = $2
select … from "proxy_keys" where id = $1
```

| request | eager resolve wall time (laptop → Neon branch) |
| --- | --- |
| initialize | 121, 128, 122 ms |
| notifications/initialized | 119, 237, 124 ms |
| GET (SDK only) | 122, 147, 136 ms |
| tools/list | 212, 162, 119 ms |

Client-side, one cycle: `connect()` 313–437 ms, `tools/list` 170–268 ms.
Laptop-to-Neon latency (~30 ms per round trip) inflates this relative to
Vercel iad1, but the count is what matters: **12 sequential round trips per
Claude Code start-up (16 for a stock SDK client), one of them a write**, and
the production number is captured from now on as `connection_resolve_ms` on
`mcp_auth_attempt`.

Scaled to the loop client on 2026-09-07 (1,764 initializes × 3 requests):
~21,000 Neon round trips, ~5,300 of them `UPDATE agent_connections`, for 18
tool calls.

## With the memo (default)

| request | eager resolve |
| --- | --- |
| first initialize after the module loaded | ran, 286 ms (includes the hot-reload compile) |
| every later request inside the 5-minute window (initialized, GET, tools/list, the next cycles' initializes) | skipped, zero queries |

Client-side, one cycle: `connect()` 62–81 ms, `tools/list` 38–85 ms — the
remaining time is Clerk token verification (memoised strategy) plus the
handler itself. Handshake wall time drops ~4–5x locally; on Vercel the
absolute saving is smaller but the write amplification on
`agent_connections` and the four-round-trip floor under every request go
away for warm instances.

The initialize-specific guard held: the first initialize for the probe
client ran the resolve (the row was created by an initialize, so it was
named at creation), and later initializes skipped. Coalescing was observed
the same way: one `mcp_client_initialize` capture per module instance per
window.

## Validation status

- [x] `scripts/test-connection-touch-memo.ts` — 21 checks pass.
- [x] `npx tsc --noEmit` clean.
- [x] Local cycles: baseline vs memo as above.
- [ ] `npm run mcp:lint` full suite (run before commit).
- [ ] Preview: cycles against the preview URL, then `docs/monitoring.md`
      §7.15 queries with `environment = 'preview'`.
- [ ] Production, day after deploy: §7.15 — `skipped` majority,
      `mcp_client_initialize` rows/day well under 2,000.
