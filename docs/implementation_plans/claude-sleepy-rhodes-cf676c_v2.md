# QA scope for the next release (branch `claude/sleepy-rhodes-cf676c`)

Written after merging `claude/distracted-germain-3d9e18` into this branch.

## Release window

Production is at `8741b53` (deployed 2026-08-25). `origin/main` is already
ahead of it at `5a77b2b` (PR #87, the approvals rewrite), so **the approvals
work is unreleased even though it is on main** and belongs in this QA pass.
Local `main` is stale — diff against `8741b53` or `origin/main`, not `main`.

Code surface, `8741b53...HEAD`:

| file | lines | origin |
| --- | --- | --- |
| `src/lib/approvalLinks.ts` | 289 | PR #87 (on main, unreleased) |
| `src/lib/approvalRequests.ts` | 75 (new) | PR #87 |
| `src/db/schema.ts` + `0010_approval_requests.sql` | 53 | PR #87 |
| `src/app/dashboard/approve/page.tsx` | 176 | PR #87 |
| `src/app/dashboard/actions.ts` | 191 | PR #87 + `7666c3a` |
| `src/app/dashboard/approve/FileApprovalFlow.tsx` | 10 | PR #87 |
| `src/app/api/mcp/route.ts` | 295 | PR #87 + Gmail telemetry + error sanitization |
| `src/lib/serverErrors.ts` | 118 (new) | this branch |

Docs-only commits are excluded; `src/lib/authSampling.ts` is already in
production and is out of scope.

## Surface areas

### 1. Approval link scheme — security-relevant, highest risk

`mintApprovalLink` / `verifyApprovalParams` replaced a single-use, expiring
JWT (`?token=`) with a deterministic HMAC over
`(userId, proxyKeyId, action, target)` carried as `?a=&k=&r=&s=`.

Three gates were **removed**: expiry, single-use, and the `jti` consumption
ledger. What remains is the Clerk session, the recomputed HMAC (which binds
the owner implicitly — `userId` is an HMAC input but never appears in the
URL), and the live `proxy_keys` ownership lookup.

Test: capability 14 end-to-end (A1–A3, A5–A14), capability 15 (A1–A7),
capability 01 A4, capabilities 09/17/19 for the sheets/docs picker-first path.

Beyond the existing assertions, verify explicitly:

- **Cross-user rejection is still the HMAC, not the ledger.** Cap 14 A5 must
  be run with a link minted for USER_A opened by a signed-in USER_B — it
  should render "Invalid link", not "Already approved" and not a 500.
- **Re-approval after revocation now re-grants.** This is deliberate and is
  *intentionally unasserted* in A14. Confirm the behavior matches the intent
  (grant → revoke in dashboard → re-open same URL → Approve → grant returns)
  so the change is a decision on record, not a discovery in production.
- **Old `?token=` links.** Any link still in an agent transcript now renders
  "Missing link". Confirm it renders that card rather than 500ing. Blast
  radius is small (old links expired in 15–30 min) but non-zero.
- **Links are environment-scoped.** The signing key derives from
  `CLERK_SECRET_KEY`, so a preview-minted link cannot approve in production
  and vice versa. Mint and approve within one environment; a cross-environment
  test is expected to fail and proves nothing.
- **Identity churn invalidates links.** The HMAC is over `users.id`. A
  tombstone-then-resignup creates a new row, so every previously minted link
  for that person goes invalid. Worth one confirmation pass against cap 06/07.

### 2. Approve page robustness — two fixes with no assertion behind them

`7666c3a` added `tryGetDbUser()` because `getDbUser()` throws for two reasons a
public-facing page must not 500 on: signed out, and Clerk-authenticated with no
`users` row yet.

- Clerk session, no FGAC `users` row (a bystander who received a leaked link
  and has never loaded the dashboard) → must render "Invalid link".
- Session expires while the approve page is open, then Approve is clicked →
  the server action must *resolve* with the session-expired message, not
  reject. A rejected server action leaves the button stuck on "Approving…"
  with no error.

Neither case has an assertion in any capability doc. See Gaps below.

### 3. `approval_requests` ledger + migration 0010 — deploy-path risk

New table, two FKs, written best-effort from three MCP mint sites and two
dashboard stamp sites.

- Confirm `0010_approval_requests.sql` applies on the preview Neon branch.
  `migrate.ts` discovers migrations by `readdirSync` on the directory, not
  from `_journal.json`, so the journal's gap at idx 8/9 does not block
  discovery — but re-runs rely on "already exists" being ignorable, so verify
  a **second** deploy of the same branch also succeeds.
- `approval_consumptions` is deliberately retained and unread. Confirm nothing
  writes it any more and that no query still joins it.
- Every ledger write is wrapped in try/catch by design: a denial must not fail
  because bookkeeping failed. Verify a denial still returns its link when the
  ledger write fails (a broken-DB negative test, if it can be staged safely).

### 4. Google error classification — agent-facing copy, no assertion

`describe403` splits what was one message into four branches: rate limit
(`rateLimitExceeded` et al., `usageLimits`, `RESOURCE_EXHAUSTED`),
`domainPolicy`, genuine scope failure, and a hedged default. Google's generic
`forbidden` deliberately falls through to the hedged branch.

`gmailNotFoundResult` splits Gmail 404s by call site: a bad `messageId` says
STOP, a bad `attachmentId` on a valid message says re-read the message once.

These change what an agent *does* next, which is the whole point of the fix,
and nothing asserts the message text. At minimum drive the two Gmail 404
branches (a fabricated `messageId`; a valid message with a stale
`attachmentId`) and confirm each returns its own text. The 403 branches are
hard to trigger on demand — assert the reachable ones and say which were not
exercised rather than marking the area covered.

### 5. Telemetry property contract

New props: `error_reason`, `error_domain`, `failure_reason`,
`gmail_404_site`, `request_id`, `mint_count`, `agent_driven`, `user_agent`.
`link_id` is gone. Capability 16 A10–A13 specify these.

`failure_reason` is deliberately *not* `errorResult` — these stay `textResult`
so `$mcp_is_error` (which the Anthropic Connector Directory reads) does not
inflate. Verify that classification did not drift.

**Production verification of this area is blocked**: the PostHog connector is
not loaded in this session and `POSTHOG_PERSONAL_API_KEY` is unprovisioned.
Name the HogQL query and the expected result rather than leaving "verify in
PostHog" implicit.

### 6. MCP error sanitization (this branch)

`withToolAnalytics` no longer rethrows; every tool's unhandled exception
returns a constant message. Covered by `scripts/test-server-errors.ts` and
`scripts/test-mcp-tool-errors.ts` in `mcp:lint`.

Not covered: an authenticated MCP call against a build of this branch. Every
capability suite exercises it implicitly — any tool that now returns
"FGAC hit an internal error" instead of working is a regression from this
change. Watch for it across the whole run.

## Gaps in the QA spec itself — fix before running

1. **Capability 16 has two `### A10:` headings** (lines 72 and 204).
   `scripts/qa-coverage-check.ts` collects assertion ids into a `Set`, so the
   two collapse into one and a runner reporting `A10` satisfies both. The
   arbiter CLAUDE.md calls authoritative would report full coverage while one
   assertion went untested. Renumber the second to `A14`.
2. **No assertion covers §2** (no-`users`-row visitor; session expired mid-
   page). Both were found by QA on 2026-08-26 and fixed without a regression
   assertion.
3. **No assertion covers §4** (403 branching, Gmail 404 disambiguation).

## Suggested order

`/qa-hosted-mcp` first (touches every surface), then `/qa-claude-code` for the
approval flows, then a targeted pass on 09/17/19 for picker-first. Environments
run sequentially — they share the dev server, the Neon branch, and the QA
accounts.
