# MCP handshake loops — revision 3: preview validation

Branch: `claude/adoring-snyder-eea430` — revision 3 (2026-09-08). PR #124,
preview deployment of commit c3bd2ed. v1 (findings, decision) and v2 (local
measurements) stand unchanged.

## What ran against the preview

The same SDK-transport cycle script as v2 (initialize → initialized → the
SDK's GET → tools/list → close), authenticated with the dev-Clerk QA token
minted for the local server — previews serve the dev Clerk instance, so the
token verified unchanged. Sequence, all times UTC:

| when | cycles | purpose |
| --- | --- | --- |
| 22:16–22:17 | 6 | first contact: connection creation on the preview branch |
| 22:17:43–22:18:19 | 40 | fill the 5-minute window (~184 requests) |
| 22:23:18 | 2 | first initialize after the window closed |

## What PostHog recorded (`environment = 'preview'`)

| time | event | detail |
| --- | --- | --- |
| 22:17:09 | `mcp_client_initialize` | `coalesced_initializes = 0` (first capture on instance A) |
| 22:17:09 | `mcp_connection_created` | the eager resolve created the row on first contact |
| 22:17:44 | `mcp_client_initialize` | `coalesced_initializes = 0` (first capture on instance B — the 40-cycle burst landed on a second warm instance) |
| 22:17:48–22:18:11 | 6 × `mcp_auth_attempt` (sampled 1-in-20) | every one `connection_resolve = 'skipped'`, POST and GET alike |
| 22:23:19 | `mcp_client_initialize` | **`coalesced_initializes = 24`** — the instance that answered after the window reported the 24 initializes it had suppressed; the other instance holds the remaining ~22 until its own next capture |

So over ~48 handshakes the project received 3 initialize rows instead of 48,
and `sum(1 + coalesced_initializes)` = 27 with one instance's window still
open — the per-instance accounting the docs describe. The runbook §7.16
queries ran as written against both environments (production rows have no
`coalesced_initializes` yet and sum as 1 each).

Client-side on the preview (laptop → iad1): `connect()` 230–304 ms,
`tools/list` 135–310 ms after the first cycle; a 'ran' sample did not land in
the 1-in-20 draw during this run, so the production `connection_resolve_ms`
baseline comes from the first post-deploy day.

## Validation status

- [x] `npm run mcp:lint`, `npx tsc --noEmit`
- [x] local cycles with and without the memo (v2)
- [x] preview deployment Ready for c3bd2ed; landing page renders
- [x] preview cycles + §7.16 queries with `environment = 'preview'` (above)
- [ ] production, day after deploy: §7.16 — `skipped` majority,
      `mcp_client_initialize` rows/day well under 2,000, a `ran` p50 for the
      DB touch from iad1

## Loose ends, stated

- `claude -p` reproduction with the real CLI remains blocked by the expired
  CLI login on this machine (user action: `claude login`). The Claude Code
  facts in v1 come from documentation via the guide agent and from
  production request shapes, not from a local CLI run.
- The daily analytics review task (local scheduled task
  `fgac-user-behavior-review`) was given a note to count sessions as
  `sum(1 + coalesced_initializes)` and to run §7.16; it lives outside the
  repo.
