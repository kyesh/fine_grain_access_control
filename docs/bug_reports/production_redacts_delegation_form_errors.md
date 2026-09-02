# Production redacts delegation-form errors into the digest message

**Reported**: 2026-09-01, via support ("Token Lookup Problem" thread). Symptom:
submitting Dashboard → Accounts → "Delegations You've Granted" showed "An
error occurred in the Server Components render. The specific message is
omitted in production builds… A digest property is included…" and the
delegation was not saved.

## Root cause

`createDelegation` (src/app/dashboard/actions.ts) deliberately **threw** plain
`Error`s for expected cases — empty email, self-delegation, and "No FGAC
account found for X" — with a comment asserting "the caller renders the
message". That holds in dev only: production Next.js replaces the message of
any error thrown from a server action with the opaque digest text, so
`DelegateAccessButton`'s `err.message` rendering showed gibberish precisely
when the user needed instructions.

In the reported case the delegate genuinely had no FGAC account yet (she
signed up hours later), so the intended message — "ask them to sign up
first" — was exactly the answer the customer needed and never saw.

The codebase already knew this failure mode: `RuleActionResult` (same file)
was introduced 2026-04 because thrown rule-validation errors were redacted the
same way. The delegation and key-creation actions predate that pattern and
were never converted.

## Fix (branch `claude/affectionate-elion-98e748`)

1. `createDelegation` returns `{ok: true} | {ok: false, error}`; the form
   renders the returned error. `createProxyKey`'s expected-case refusals
   likewise return `{error}` (its client already handled value errors), and
   its delegation validation moved before the key insert so a refusal no
   longer leaves an orphaned key.
2. The delegate lookup is drift-tolerant: on a `users.email` miss it resolves
   the address through Clerk (verified addresses only) via `resolveDbUser`,
   healing drifted delegate rows and provisioning delegates who signed up but
   never loaded the dashboard. (PR #107 covers the MCP token-fallback half of
   drift; this covers the delegation half.)
3. `ensureDefaultProfile` now also self-heals the own-mailbox access row, for
   accounts stranded by the pre-`4b551018` drift window with no row for their
   current address.

## Rule of thumb

A server action that a client component renders feedback from must **return**
expected-case failures as values. `throw` is reserved for genuinely
unexpected failures, where the digest behavior is acceptable.

## Related

- docs/bug_reports/identity_email_drift_breaks_token_lookup.md
- docs/implementation_plans/delegation-form-prod-errors_v1.md
