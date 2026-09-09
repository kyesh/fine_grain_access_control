# Revoked Google grant classified as a transient Clerk error

**Found**: 2026-09-09, daily analytics review (PostHog, `environment =
production`). A new `google_token_fetch_failed` signature appeared on
2026-09-08 and grew: `reason = clerk_error`, `clerk_status = 400`,
`clerk_code = oauth_token_retrieval_error`, `retried = true`, own mailbox
(not delegated). Three accounts, 23 failures in two days, zero recoveries.

## Symptom

- The heaviest affected account issued 14 `sheets_get_spreadsheet` calls over
  two days that all failed (outcome `failed`, no `error_status` — the call
  never reached Google) while a delegated mailbox on the same key kept
  succeeding. Those 14 were most of the class that put the tool at a 14.5%
  trailing-7-day error-or-failed rate (35 of 242 calls), the top public-optics
  tool on the connector directory that week.
- A second account made two `gmail_list` calls, both failed, and went silent.
- A third signed in to FGAC on 2026-09-09, worked for ~2.5 h on the fresh
  access token, then failed on every call once Clerk had to refresh.
- The server-side one-shot retry (2026-09-04) recovered nothing:
  `google_token_retry = 'recovered'` is 0 on every day since it shipped; every
  `retry_failed` row was this code.
- The agents called `list_accounts` right after their first failure and got
  `google_token: 'unavailable'`, `google_token_failure: 'clerk_error'` — no
  `reconnect_url`, no instruction — then kept retrying.

## Root cause

`classifyClerkTokenError` (src/lib/googleTokenFailure.ts) knew three
deterministic shapes (404 owner missing, anything matching /refresh/, no
grant) and treated every other Clerk error as transient. Clerk's 400
`oauth_token_retrieval_error` — "Failed to retrieve a new access token from
the OAuth provider" — matched none of them, so it fell through to
`clerk_error`: one pointless retry (300 ms + a second Clerk round-trip), a ❌
"usually temporary … Retry ONCE" answer, and no reconnect link from
`list_accounts` (which mints one only for reasons a reconnect repairs).

What the code actually means, established read-only against the production
Clerk Backend API for all three accounts: Clerk asked Google to refresh and
Google answered `invalid_grant "Token has been expired or revoked."`. The
external accounts were still `verified` in Clerk (so nothing on the dashboard
looked wrong until the token bridge failed), and no account produced a single
own-mailbox success after its first failure. Google revokes a refresh token
when the user removes the app under "Third-party apps with account access",
changes their Google password (Gmail-scoped grants), or leaves the grant
unused for six months. The same code had been recorded as a dead QA grant on
2026-08-06 (`docs/implementation_plans/third-party-handoff-permissions_v6.md`).

Not a deploy regression: the first failure (2026-09-08 05:34Z) predates the
day's production merges (PR #122 14:33Z, PR #123 2026-09-09 00:15Z), and the
token-fetch path in the MCP route had not changed since 2026-09-05. The
2026-09-04 scope-narrowing work (tokeninfo pre-flight, `reconcileScopes`)
runs after the Clerk fetch and does not change what Clerk is asked for.

Note for the next triage: `@clerk/backend` maps `errors[].meta` onto a fixed
key set and drops `provider_error`, so the SDK-thrown error never shows the
Google detail. Read it from the raw Backend API when it matters.

## Fix (this PR)

- `oauth_token_retrieval_error` classifies as a new deterministic reason
  `grant_revoked`: no retry, 🚫 `google_token_unavailable` refusal that quotes
  Google's answer and names the likely causes, owner-bound reconnect link,
  `denied_by_policy` outcome (leaves the published error rate). If a future SDK
  relays a provider error that is explicitly NOT an `invalid_grant` (a Google
  token-endpoint outage), the class stays transient.
- `list_accounts` mints `reconnect_url` for it and adds a top-level
  `next_steps.reconnect` nudge ("every call on it fails until reconnected, do
  not retry, give the user this link"); the tool description says so.
- The proxy and grant-check paths use the same classifier and stamp
  `clerk_status` / `clerk_code`, so the code cannot hide as `clerk_error`
  there either.
- `$mcp_tool_call` carries `google_token_clerk_code`, so the per-tool error
  table splits dead grants from upstream trouble without a join.
- docs/monitoring.md §7.13a (queries + healthy shape), docs/analytics.md,
  QA capability 18 A12, 16 A19, 04 A8; unit tests in
  scripts/test-google-token-failure.ts.

## Follow-ups (not in this PR)

- The reconnect link lands on the Accounts page, which auto-fires
  `reauthorize()` for a `verified` external account. For a revoked grant
  Google shows consent again and issues a new refresh token, so this should
  repair in one pass — confirm with §7.8's reconnect funnel for the affected
  people once they open the link.
- Consider a dashboard card for `grant_revoked` (the Accounts page already
  shows the disconnected state via `checkGoogleAccess`, which fails closed).
- Whether the one-shot retry earns its keep at all: zero recoveries since
  2026-09-04. Left in place for genuinely unknown Clerk errors.
