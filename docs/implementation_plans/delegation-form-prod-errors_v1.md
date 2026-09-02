# Delegation form: production-safe errors + drift-tolerant delegate lookup — v1

Branch: `claude/affectionate-elion-98e748`. Trigger: support email 2026-09-01
("Token Lookup Problem") — a customer granting a delegation from the dashboard
got the opaque production digest error ("An error occurred in the Server
Components render…") and the delegation was not saved.

## What actually happened (established read-only against prod)

1. The customer opened Dashboard → Accounts → Delegations You've Granted,
   typed the delegate's address, clicked Grant.
2. `createDelegation` looked the delegate up by `users.email` and found no
   live row — **the delegate had not signed up yet**: her `users` row (and
   default profile) was created ~8.5 hours *after* the failed attempt, when
   she completed signup.
3. The action threw its intended, helpful message ("No FGAC account found for
   X. Ask them to sign up…"). In production Next.js **redacts messages of
   errors thrown from server actions** and substitutes the digest text, which
   is what the client's `err.message` rendering showed. The user got
   gibberish exactly where the product had the right answer.

So the *throw-and-render* pattern (mechanism 1) is the customer-visible bug;
the delegate-account timing was the trigger. Identity drift (the delegate is
the known `google_token_identity_fallback` case) was NOT the direct cause of
this failure, but the same lookup is drift-fragile: a delegate whose
`users.email` has drifted away from their sign-in address is equally
unfindable. PR #107 heals drift only in the MCP token fallback branch — the
delegation path needs its own tolerance.

Additional latent damage found during verification: the reporting customer's
own default profile has **no own-mailbox `key_email_access` row for her
current address** (its only own row targets the delegate's address — a
pre-`4b551018` drift artifact where `users.email` was re-synced before the
access-row re-point existed). `resolveDbUser` only re-points rows *when the
email changes*, so this state never self-healed.

## Changes

1. **`createDelegation` returns `DelegationActionResult`** (`{ok:true} |
   {ok:false, error}`) instead of throwing for expected cases (empty email,
   self-delegation, unknown delegate). `DelegateAccessButton` renders
   `result.error`; the try/catch remains as a generic backstop for real
   failures. Same contract as `RuleActionResult`, which was introduced for
   exactly this redaction problem.
2. **`createProxyKey`**: the "Label is required" and "No active delegation
   grants you access to X" refusals are now returned as `{error}` (the client
   already handles value errors from the slug-clash check). Delegation
   backing is resolved **before** the key insert — the old throw fired after
   the insert and left an orphaned key with partial access.
3. **Drift-tolerant delegate lookup** (`findDelegateUser`): on a
   `users.email` miss, ask Clerk who holds the address (verified addresses
   only) and resolve that Clerk user's row via `resolveDbUser` — which heals
   drifted rows (email sync + own-mailbox access-row re-point, as a dashboard
   load would) and provisions a row for a delegate who signed up with Clerk
   but never loaded the dashboard. Complements PR #107 (which covers only the
   MCP token fallback); no shared code, no conflict — #107 touches
   `src/app/api/mcp/route.ts` / `src/lib/identityDrift.ts`, this branch
   touches the dashboard actions.
4. **`ensureDefaultProfile` self-heal now includes the own-mailbox row**: the
   existing-key branch previously re-materialized only delegated access; it
   now also inserts (idempotently) the own row for the user's current
   address, repairing keys stranded by the pre-`4b551018` drift window. The
   stale row pointing at the old address is deliberately left in place —
   token resolution refuses it, and removing rows has its own hazards.

## Audit: remaining throw-and-render sites in dashboard actions

`revokeDelegation`, `revokeProxyKey`, `rollProxyKey`, `deleteRule`,
`setSheetRulePermission`, `assignRulesToKey`, `unassignRuleFromKey`,
`enableSendToAnyone`, `exposeSheetsFromPicker`/`exposeDocsFromPicker` still
throw plain `Error("Unauthorized…")`. These are unreachable through normal UI
use (they require a stale tab or a tampered id), and their client components
don't render `err.message` — the failure mode is a silent no-op plus a server
log, not user-facing gibberish. Left as-is deliberately; converting them
would touch six client components for no customer-visible gain. Revisit if
any of them gains a user-typed input.

## Validation

- `tsc --noEmit`, `eslint`, `npm run mcp:lint` clean.
- Local (dev server, QA accounts): empty/self/unknown-delegate submissions
  show inline messages; known-delegate grant creates the delegation and syncs
  the delegate's Default Profile.
- Preview deployment (production build — the redaction behavior only exists
  there): unknown-delegate submission must show the real message, not the
  digest text.
