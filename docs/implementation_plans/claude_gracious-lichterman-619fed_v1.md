# Google token failures: retry the race, say who must reconnect

Branch: `claude/gracious-lichterman-619fed` · 2026-09-04 · from the 2026-09-04 analytics review

## Problem as handed over

When Clerk cannot return a Google access token for the target mailbox, every MCP
tool answers with one sentence — "Could not fetch Google token for '<email>'. The
account owner may need to reconnect Google — one-click link: …" — regardless of
cause, and without saying who must open the link. One external user's agent hit
this once a day on a DELEGATED mailbox for two weeks; another hit it on their own
account. The handover proposed graduating the failure to a 🚫 reconnect refusal
(consistent with PR #113) and stamping `error_reason`.

## What the data established (PostHog, production, re-verified 2026-09-04)

Queries run over `environment='production'` with the five internal addresses
excluded; addresses stay out of this file (public repo).

1. **Counts confirmed.** 7-day window: 8 × `google_token_fetch_failed`
   `reason=clerk_error` (7 delegated, one person, one per day; 1 own-account,
   a second person) and 1 × `google_token_error=no_token` on a tool call (third
   person, 38 s after their `mcp_connection_created`). 30-day history: the
   delegated failure has fired exactly once a day since 2026-08-21; the
   standalone event totals 25 events / 6 people, 6 of which are `grant_check`
   probes on one day.
2. **The daily delegated failure is a race, not a broken grant.** Per-call
   sequence on each of 09-01/02/03: the agent's first touch of the delegated
   mailbox is two `gmail_list` calls 66–1100 ms apart; one fails
   `google_token_unavailable` / `clerk_error` with `token_ms` ≈ 80–120, the
   other succeeds (`token_ms` ≈ 100–140), and every later call on that mailbox
   that day succeeds. The grant is healthy. The tool text told the agent to
   reconnect, daily.
3. **The own-account `clerk_error` was transient too.** The same person's next
   token fetch (80 minutes later) succeeded — their real blocker was scopes
   (`gmail_scope_missing` then `drive_file_scope_missing`), which PR #113 already
   graduates to 🚫 with the reconnect link.
4. **`error_reason` is not the gap.** The tool-call event already carries
   `google_token_error` with the cause; the 90 statusless `failed` rows are
   attributable through `failure_reason` + `google_token_error`. `error_reason`
   is documented as "Google returned this reason" and the token layer never
   reaches Google — stamping it would corrupt that series.
5. **Reconnect links cannot be used by the delegate.** `reconnectLink(target)`
   binds `for=<owner>`; the Accounts page blocks auto-reconnect and shows a
   "sign out, sign in as <owner>" card for any other signed-in user (QA 18 A6).
   The correct instruction is "forward this to the owner, who opens it signed in
   as that account". One `google_reconnect_wrong_account` in 30 days says this
   confusion is real but rare.
6. **Reconnect works when reached**: 6 `google_reconnect_returned` → 6
   `google_reconnect_verified` in 30 days.

## Decisions (accepted / rejected against the handover's candidates)

- **Rejected: a blanket 🚫 reconnect refusal for every token failure.** For the
  only class seen in production (`clerk_error`) it would be a daily false alarm
  aimed at a working grant, and a STOP instruction would turn a self-healing
  blip into a hard failure.
- **Accepted, narrowed: 🚫 with `denial_code: 'google_token_unavailable'` for
  states that cannot clear on their own** — `no_token` (no Google grant stored)
  and `refresh_failed` (Clerk 422 cannot-refresh). Consistent with #113's
  boundary: deterministic, user-fixable, remediation attached. `failure_reason`
  stays stamped for continuity.
- **Added: server-side retry.** Unknown Clerk errors are retried once after
  300 ms (`google_token_retry: 'recovered' | 'retry_failed'`). The observed race
  resolves within ~100 ms, so the agent should stop seeing it at all. Timeouts
  (budget spent) and refresh failures (deterministic) are not retried.
- **Accepted: who-must-reconnect wording.** Delegated mailboxes: "only its owner
  can repair it; the key owner cannot fix it from their own dashboard; forward
  the link to the owner, who opens it signed in as that account". Transient
  failures say "retry ONCE" before offering the link.
- **Accepted: list_accounts surfaces the state** — `google_token`
  (`ok`/`unavailable`/`unknown`), `google_token_failure`, and `reconnect_by`;
  links only for deterministic failures (a transient probe failure no longer
  mints a false reconnect link).
- **Rejected: `error_reason = 'google_token_*'`** (see finding 4).
- **Rejected: delegator outreach** — the delegator's grant is healthy.
- **Added on the way:** the "access row exists but delegation inactive" branch
  (previously the same token text) gets `failure_reason: 'delegation_inactive'`
  and re-delegate guidance with no link; the standalone event now fires for
  `no_token`; the event carries `retried`, `clerk_status`, `clerk_code` so the
  next triage can read what Clerk said instead of inferring from timing.

## Change set

- `src/lib/googleTokenFailure.ts` (new): `classifyClerkTokenError`,
  `isDeterministicTokenFailure`, `tokenFailureGuidance` — pure, unit-tested.
- `src/app/api/mcp/route.ts`: `getGoogleToken` returns a typed failure instead
  of `null`, retries once, stamps the new props; `resolveAccountAndToken` routes
  through the guidance helper and stamps `denial_code` on the 🚫 path;
  `ResolveFailureReason` gains `delegation_inactive`; `list_accounts` probe
  fields as above.
- `scripts/test-google-token-failure.ts` (new, in `mcp:lint`): classification,
  deterministic boundary, wording per class and per own/delegated, structural
  guard that the route uses the helper and the old text is gone.
- Docs: `docs/analytics.md` (event props, tool-call prop, failure_reason split),
  `docs/monitoring.md` §7.12 (retry watch query), QA capability 16 A10, 18 A4,
  04 (list_accounts fields).

## Interaction with PR #113

Trial-merged locally: no conflicts. #113 edits the comment above
`ResolveFailureReason` and the scope pre-flights; this branch edits the branch
body below and `getGoogleToken`. The `denial_code` string here follows #113's
taxonomy (`failure_reason` value reused as the code).

## Validation

- `npm run mcp:lint` (includes the new test), `tsc --noEmit`, eslint.
- Preview via `/deploy-pr-preview`: `list_accounts` on a QA key shows
  `google_token: 'ok'` per account; a Gmail call on a healthy account is
  unchanged. Inducing a Clerk-side token failure on demand is not possible with
  the QA accounts (the same limitation QA 16 records for `google_token_unavailable`),
  so the per-class texts are covered by the unit test.
- Post-deploy PostHog check (named): §7.12 query shows `google_token_retry =
  'recovered'` rows appearing (≈1/day, `account_delegated=true`) and
  `google_token_fetch_failed` with `reason='clerk_error'` stopping; any
  `retry_failed` row is the signal to look at `clerk_status`/`clerk_code`.
