# Revoked Google grants: classify `oauth_token_retrieval_error` as deterministic — v1

Branch: `claude/epic-brattain-f21f5d` (off `main` @ d25ae3f, 2026-09-09).
Companion bug report: `docs/bug_reports/revoked_google_grant_classified_as_transient.md`.

## Problem

Since 2026-09-08 a new `google_token_fetch_failed` signature (Clerk 400
`oauth_token_retrieval_error`, classified `clerk_error`, retried, own mailbox)
hit three production accounts, 23 failures, zero self-recoveries, and drove
most of `sheets_get_spreadsheet`'s trailing-7-day error rate. The response
text said "usually temporary — retry once", the server retried pointlessly, and
`list_accounts` showed the account as unavailable with no reconnect link.

## Established before building (all re-verified with own HogQL, project 343912)

1. **What the code means.** Clerk docs: `oauth_token_retrieval_error`, HTTP 400,
   "Failed to retrieve a new access token from the OAuth provider". Raw
   Backend API probe (read-only, `.secrets/prod.env`, deleted after) for all
   three accounts: `meta.provider_error = oauth2: "invalid_grant" "Token has
   been expired or revoked."`; external accounts still `verified`. The
   installed `@clerk/backend` 3.4.7 drops `meta.provider_error` when it builds
   `ClerkAPIError`, so the SDK-thrown error carries only the code.
2. **Self-recovery.** Own-mailbox successes after each account's first
   failure: 0, 0, 0. One account's delegated mailbox kept succeeding (its
   owner's grant is fine). Retry `recovered` count since 2026-09-04: 0.
3. **Deploy correlation.** First failure 2026-09-08 05:34Z; PR #122 merged
   14:33Z, PR #123 merged 2026-09-09 00:15Z; no token-path change in the MCP
   route since 2026-09-05; the tokeninfo/`reconcileScopes` work runs after the
   Clerk fetch. Not a regression from our side.
4. **`list_accounts` behaviour.** Probes classify `clerk_error` → `google_token:
   'unavailable'` with no `reconnect_url`; two of the three agents called it
   immediately after their first failure.

## Decisions

- **Accept**: map the code to a new deterministic reason `grant_revoked`
  (rather than overloading `refresh_failed`, so analytics can tell "Google
  refused the refresh" from "no refresh token stored"). 🚫 + reconnect link,
  no retry, `list_accounts` mints the link, plus a top-level
  `next_steps.reconnect` nudge. Escape hatch: if a future SDK relays a
  provider error that is explicitly not `invalid_grant`, stay transient.
- **Accept**: stamp `google_token_clerk_code` on `$mcp_tool_call`.
- **Accept**: proxy and grant-check paths share the classifier and stamp
  `clerk_status` / `clerk_code`.
- **Reject**: "after N consecutive clerk_error failures, promote to reconnect".
  The ❌ text already carries the link as the second instruction; a counter
  needs cross-invocation state per account, and with this code mapped the
  residual `clerk_error` class is genuinely unknown.
- **Reject**: removing the one-shot retry. Zero recoveries so far, but it costs
  nothing for deterministic classes (not retried) and is the right shape for a
  real Clerk blip. Recorded in §7.13a as a watch item.
- **Out of scope**: dashboard changes (the Accounts page already fails closed
  and offers Reconnect Google); the reconnect funnel for the three affected
  people is monitored via §7.8.

## Changes

- `src/lib/googleTokenFailure.ts`: `grant_revoked` reason, classifier branch,
  deterministic + reconnect-repairs sets, refusal text, `providerError` field.
- `src/app/api/mcp/route.ts`: retry comment, `google_token_clerk_code` on the
  tool call, `provider_error` on the event, `next_steps.reconnect` nudge.
- `src/app/api/mcp/toolDefs.ts`: `list_accounts` description covers the dead
  grant state.
- `src/app/api/proxy/[...path]/route.ts`, `src/lib/driveFileGrantCheck.ts`:
  shared classifier + status/code props.
- `scripts/test-google-token-failure.ts`: classification, wording, structural
  guards (route, proxy, grant check, list_accounts nudge).
- Docs: `docs/monitoring.md` §7.13a, `docs/analytics.md`, QA capabilities 04
  A8, 16 A19, 18 A12; bug report.

## Validation

- `npm run mcp:lint` (includes the unit tests), `tsc --noEmit`, `eslint`.
- Local: `list_accounts` / tool call against a healthy QA account unchanged
  (no `next_steps.reconnect`, no link). Inducing a revoked grant requires
  revoking FGAC on the Google side for a QA account (capability 18 A12 fixture)
  and waiting for token expiry — run in the preview if time allows; otherwise
  the unit tests pin the behaviour and A12 records that.
- Preview via `/deploy-pr-preview`.
- Post-deploy PostHog check (docs/monitoring.md §7.13a): new
  `oauth_token_retrieval_error` rows carry `reason = 'grant_revoked'`,
  `retried = false`; the affected accounts' tool calls turn `denied_by_policy`;
  `google_reconnect_*` for those people shows whether the link converted.
