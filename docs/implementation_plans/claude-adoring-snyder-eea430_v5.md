# MCP handshake loops — revision 5: keep every initialize event

Branch: `claude/adoring-snyder-eea430` — revision 5 (2026-09-09). PR #124.
Reverses one of the three accepted directions from v1 after review.

## Decision

Ken asked why this needed fixing at all — cost, muddy data, or performance —
given that the handshake events are genuine and describe how a user works.
The honest split:

| concern | weight | what the PR does about it |
| --- | --- | --- |
| cost | negligible ($0.08 of invocations a cycle; Neon awake anyway; handshakes ~6% of the PostHog free tier) | nothing needed |
| performance | modest but real: four sequential Neon round trips and one write on every authenticated request, result unused | **memo kept** — pure waste removed, no information lost |
| muddy data | the strongest case: two clients dominate initializes-per-person, the auth-success estimate, probe share and the connect-then-silence watch | **query-side**: runbook §7.16 names loop clients so the daily review reports them and excludes them from ratios |

Coalescing the initialize event (direction c) is **dropped**. It kept counts
reconstructible but discarded the per-event timestamps and versions inside a
five-minute window — exactly the grain that produced today's finding (the 29 s
median gap, two versions interleaving hour by hour, the process-per-query
shape). A customer building automation on FGAC with the Agent SDK is a
power-user signal worth watching at full resolution, and the volume does not
justify losing it. The threshold at which coalescing becomes worth its cost is
written into §7.16 (the event alone approaching ~300k rows/month, 30% of the
free tier).

## What changed in this revision

- `src/app/api/mcp/route.ts`: `mcp_client_initialize` captured on every
  authenticated initialize again, no `coalesced_initializes` property; the
  comment records why it is deliberately uncoalesced.
- `src/lib/connectionTouchMemo.ts`: `coalesceInitialize` and its entry fields
  removed; the module is now only the DB-touch memo.
- `scripts/test-connection-touch-memo.ts`: coalescing checks removed (13
  checks remain).
- `docs/analytics.md`, `docs/monitoring.md` §7.16: `count()` is the session
  count again; the decision and the volume threshold are recorded.
- The local daily-review task note was updated to match.

What stays from v1–v4: the memo (kill switch `MCP_CONNECTION_TOUCH_MEMO`),
`connection_resolve` / `connection_resolve_ms` on `mcp_auth_attempt`, the
§7.16 named queries, the real Claude Code reproduction.

## Validation

- [x] `scripts/test-connection-touch-memo.ts`, `npm run mcp:lint`, `npx tsc --noEmit`
- [x] preview redeploy of this revision (8eae791): a 20-handshake burst at
      00:41–00:42Z produced exactly 20 `mcp_client_initialize` rows (plus the
      runner's probe), and every sampled `mcp_auth_attempt` inside the window
      was `connection_resolve = 'skipped'`
- [ ] production, day after deploy: §7.16
