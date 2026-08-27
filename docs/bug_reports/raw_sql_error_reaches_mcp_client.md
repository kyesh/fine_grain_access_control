# A database error's raw SQL reached the MCP client

**Reported**: 2026-08-26. Symptom: every Gmail tool call through the FGAC
connector returned, as the tool result, the literal text

```
Failed query: select "id", "clerk_user_id", "email", "deleted_at", "created_at", "updated_at" from "users" "users" where "users"."clerk_user_id" = $1 limit $2
params: <the caller's Clerk user id>,1
```

Two separate defects are tangled in that one string, and they have opposite
scopes: the tool calls failed for **one stale local dev server**, but the raw
SQL would have reached the client from **any** environment, production
included.

## Defect 1 — the reported failure was not production

The failing server was a Next dev server on `localhost:3000`, started
2026-08-23 from a different git worktree and long orphaned (its parent process
was already gone). The `fgac-gmail` MCP connector in this repo's Claude Code
config points at `http://localhost:3000/api/mcp`, so every "connector" call in
that session went there, not to fgac.ai.

That server's isolated Neon branch credentials had stopped working —
`password authentication failed for user 'neondb_owner'`, the signature of a
dev branch that was deleted or had its role password rotated out from under a
long-running process. Every query it made failed, starting with the first one
in the auth path.

Production was healthy throughout, verified three ways:

- the production `users` table has all six columns the query selects,
  `deleted_at` included — no schema drift (`deleted_at` shipped in migration
  `0005`, 2026-07-26, and migrations `0008`/`0009` already join on it, so a
  missing column would have broken the deploy a month earlier);
- the production database answered read-only queries directly;
- production `/api/mcp` runtime logs show ordinary traffic with no query
  failures.

Contributing factor worth knowing about: several worktrees run dev servers and
they contend for port 3000, so "the connector" can silently point at whichever
one currently owns the port — including a stale one. `npm run env:check` in the
serving worktree is the fastest way to tell.

## Defect 2 — the raw error reached the client (environment-independent)

`resolveConnection` (src/app/api/mcp/route.ts) is the first thing every tool
does, and it is entirely database work. Its `users` lookup was unguarded, so a
`DrizzleQueryError` propagated out of `requireApproval`, out of the tool
callback, and into the MCP SDK — which converts a thrown error into
`createToolError(error.message)` and renders that message verbatim as the tool
result (`@modelcontextprotocol/sdk` `server/mcp.js`).

Drizzle's message is, by construction, the entire SQL statement plus every
bound parameter:

```js
super(`Failed query: ${query}\nparams: ${params}`)   // drizzle-orm/errors.js
```

So the leak was structural, not incidental. CLAUDE.md's Strict UI Policy —
debug identifiers and internal error objects go to server logs only — was
being violated on every unhandled throw from any of the ~20 tools.

A second, quieter problem sat inside the same message: it names the query but
**not the reason**. The actual failure lives in `DrizzleQueryError.cause`, which
the message drops. The one string anyone had to triage this incident was the
half that cannot distinguish a connection failure from schema drift.

## Fix

`src/lib/serverErrors.ts`:

- `describeErrorForLog` walks the `cause` chain (depth-bounded, cycle-safe) so
  a log line carries the reason, not just the statement.
- `clientErrorMessage` takes **no arguments**. It cannot leak, because it never
  sees the error — anything derived from an error message is one upstream
  library change away from leaking again.
- `toolErrorResult` is what a tool returns instead of throwing.

`src/app/api/mcp/route.ts`:

- `requireApproval` catches `resolveConnection` failures.
- `withToolAnalytics` — which wraps every registered tool — no longer rethrows.
  It records the `exception` outcome as before, then returns the sanitized
  result. This is the catch-all: no unhandled throw from any tool, present or
  future, can reach the SDK.
- The two pre-existing `console.error`s in the DB path now log the cause chain.

## Guards

- `scripts/test-server-errors.ts` — the client message contains no SQL, no
  identifiers, no error text, and is byte-identical regardless of what threw;
  the log line keeps the cause chain.
- `scripts/test-mcp-tool-errors.ts` — drives the real MCP SDK over an in-memory
  transport. Its first assertion is that an **unwrapped** throw still leaks,
  so the guard fails loudly rather than becoming theatre if the SDK changes.

Both run in `npm run mcp:lint`, which gates `npm run build`.
