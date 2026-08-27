# QA scope for the next release — corrected (branch `claude/sleepy-rhodes-cf676c`)

Supersedes v2, which got the release window wrong. See "Correction" below.

## Correction to v2

v2 claimed PR #87 (the approvals rewrite) was unreleased and therefore in scope.
**It is not — it deployed to production on 2026-08-27 at 00:17.**

The v2 claim rested on a `vercel ls --prod` snapshot taken earlier in the same
session, *before* the merge, and was never re-checked afterwards. Confirmed two
ways after the fact:

- the deployment aliased to `fgac.ai` is `dpl_66AsTyfh6KAU1nMzg9weVdkmfiCj`,
  created 00:17:26, four seconds after merge commit `5a77b2b` (00:17:22), and
  carries the `git-main` alias;
- the production database has the `approval_requests` table with exactly
  migration `0010`'s ten columns. That migration ships only in PR #87 and runs
  during `next build`, so its presence in production is direct evidence the
  deploy happened.

Lesson for future scope calls: a deployment listing is a snapshot, not a fact.
Re-read it after any merge, and prefer a functional check (does the schema the
change introduces exist?) over inferring from timestamps.

## Actual release window

Production is `5a77b2b` = `origin/main`. Unreleased code is `origin/main..HEAD`:

| commit | area |
| --- | --- |
| `1f437f2` `050271d` `20b2480` | Google failure-cause classification on the Gmail path |
| `90d26d3` `6fa0ee2` `fc11f52` | MCP: never let a raw database error reach the client |

```
 scripts/test-mcp-tool-errors.ts | 102 ++
 scripts/test-server-errors.ts   | 103 ++
 src/app/api/mcp/route.ts        | 217 +++-
 src/lib/serverErrors.ts         | 118 ++
```

One file of product code. No schema change, no migration, no dashboard change.

## Surface areas in scope

### 1. Google error classification — agent-facing copy, no assertion exists

`describe403` splits one message into four branches: rate limit
(`rateLimitExceeded` et al., `usageLimits`, `RESOURCE_EXHAUSTED`),
`domainPolicy`, genuine scope failure, and a hedged default. Google's generic
`forbidden` deliberately falls through to the hedged branch.

`gmailNotFoundResult` splits Gmail 404s by call site: a bad `messageId` says
STOP, a bad `attachmentId` on a valid message says re-read the message once.

These change what an agent *does* next, which is the point of the fix, and
nothing asserts the text. Drive both Gmail 404 branches (a fabricated
`messageId`; a valid message with a stale `attachmentId`) and confirm each
returns its own text. The 403 branches are hard to trigger on demand — assert
the reachable ones and say which were not exercised rather than marking the
area covered.

### 2. Telemetry properties

New: `error_reason`, `error_domain`, `failure_reason`, `gmail_404_site`.
Capability 16 A10 (the one at line 72) specifies these.

`failure_reason` paths stay `textResult`, NOT `errorResult`, so
`classifyToolOutcome` maps them to `failed` and `$mcp_is_error` stays false —
deliberately, because the Connector Directory reads that field. Verify the
classification did not drift.

### 3. MCP error sanitization

`withToolAnalytics` no longer rethrows; any tool's unhandled exception returns a
constant message. Unit-covered by `scripts/test-server-errors.ts` and
`scripts/test-mcp-tool-errors.ts` in `mcp:lint`.

The regression to watch is broad rather than deep: any tool that now returns
"FGAC hit an internal error" instead of working is caused by this change. Every
capability suite exercises it implicitly, so watch for that string across the
whole run rather than testing it in isolation.

## Out of scope, but newly live and unexercised

The approvals rewrite went to production 38 minutes before this was written and
`approval_requests` had **zero rows**. That is plausible for the elapsed time —
rows are written only when a denial or `request_access` mints a link — but it is
also exactly what a silent failure looks like, because every ledger write is
best-effort inside a try/catch by design.

This is post-release verification, not a release gate. The cheapest check is a
production HogQL query for `approval_link_minted` over the same window: events
present with zero table rows means the ledger writes are failing; neither
present means simply no demand yet.

**Blocked**: the PostHog connector is not loaded in this session and
`POSTHOG_PERSONAL_API_KEY` is unprovisioned, so this cannot be run here.

## Gaps in the QA spec

1. **Capability 16 has two `### A10:` headings** (lines 72 and 204).
   `scripts/qa-coverage-check.ts` collects assertion ids into a `Set`, so the
   two collapse and a runner reporting `A10` satisfies both. Renumber the second
   to `A14`. Still worth fixing — the surviving in-scope assertion is the one at
   line 72.
2. **No assertion covers §1** (403 branching, Gmail 404 disambiguation).
