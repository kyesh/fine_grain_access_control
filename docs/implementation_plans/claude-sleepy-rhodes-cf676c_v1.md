# Plan: raw SQL error reaching MCP clients (2026-08-26 report)

Branch: `claude/sleepy-rhodes-cf676c`

## Problem as reported

Gmail tool calls through the FGAC connector return the literal text of a failed
Drizzle query — the full `users` SELECT plus the caller's Clerk user id —
attributed to production (fgac.ai @ 8741b53). Two asks: root-cause the failure,
and stop the debug detail reaching the client.

## Findings

1. **Not production.** The connector points at `http://localhost:3000/api/mcp`.
   An orphaned dev server from another worktree owned that port; its Neon dev
   branch credentials had gone bad. Production's schema, database, and
   `/api/mcp` logs are all healthy. Detail in
   `docs/bug_reports/raw_sql_error_reaches_mcp_client.md`.
2. **The exposure is real everywhere.** The MCP SDK renders a thrown error's
   `.message` into the tool result, and `DrizzleQueryError.message` is the SQL
   plus bound params. Any unhandled throw from any tool leaks, in any
   environment.

## Approach

Fix at two layers rather than one, because they answer different questions:

- **Specific** (`requireApproval`): the connection-resolution path is pure
  database work and is the first thing every tool runs. Guarding it names the
  failure precisely in the log.
- **Catch-all** (`withToolAnalytics`): wraps every registered tool, so no
  unhandled throw — from Drizzle, Clerk, jose, or fetch — can reach the SDK,
  including from tools added later. Returning instead of rethrowing is the
  load-bearing change; the message is secondary.

The client message is a constant with no error-derived content, so the leak
cannot reappear by degrees. The compensating move is on the log side:
`describeErrorForLog` walks the `cause` chain, which is where the actual
reason lives and which Drizzle's own message omits.

## Rejected alternatives

- *Sanitize the message by pattern-matching SQL out of it.* Blocklists fail
  open; a message shape we did not anticipate leaks.
- *Only guard `resolveConnection`.* Fixes the reported path, leaves ~20 tools
  able to leak from any other unhandled throw.
- *Include a correlation id in the client message.* Useful for support, but
  the Strict UI Policy names debug identifiers specifically. Not worth the
  precedent.

## Validation

- `npm run mcp:lint` (gates `npm run build`) — includes the two new suites.
- `npx tsc --noEmit`, `npx eslint` — clean.
- `scripts/mcp-auth-probe.ts` against a local dev server built from this branch
  — 401/401/200 as expected, route compiles and serves.
- **Not** validated: a fully authenticated MCP call against a server built from
  this branch. Port 3000 (which the connector hardcodes) is held by another
  active worktree's dev server, and minting a Clerk OAuth token needs the
  browser DCR+PKCE dance on that same port — the gap already documented in
  `scripts/mcp-auth-probe.ts`. Next step is `/deploy-pr-preview`.
