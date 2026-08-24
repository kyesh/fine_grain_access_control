# Identity-email drift breaks own-mailbox token lookup

**Reported**: 2026-08-24, via support@fgac.ai. Symptom: every Sheets/Gmail call
fails with `❌ Could not fetch Google token for '<own-address>'`; the proxy key
lists the user's own address as its only accessible email; the Accounts page
shows a *different* address as the "Connected Google Account"; "Reconnect
Google" appears successful but changes nothing and never shows an account
chooser.

## Root cause

`users.email` was derived from `clerkUser.emailAddresses[0]` at five call
sites. Clerk's `emailAddresses` array order is **not** the primary address —
when a second address is added to the Clerk user (e.g. as a side effect of
Google account linking), the new address can land at index 0. On the next
dashboard load, `resolveDbUser`'s drift-sync rewrote `users.email` to it.

Everything else keyed off the original address stayed put, producing a split
identity:

- `key_email_access` (own-mailbox row) → original address
- `users.email` → the other address

`getGoogleToken` (src/app/api/mcp/route.ts) decides own-vs-delegated by
`targetEmail === keyOwner.email`. With the split, the user's own mailbox fell
into the **delegation branch**, which found no user row / no delegation for
the address and returned null — while a valid, refreshable Clerk token for
exactly that address sat on the very same Clerk user.

Two UI defects compounded the confusion:

1. The Accounts page rendered `dbUser.email` under the label "Connected Google
   Account" — it never read the actual external account. The user was shown
   the drifted identity email and concluded the wrong Google account was
   connected.
2. "Reconnect Google" reauthorizes the existing external account in place
   (correct behavior — its `updated_at` bumped on each attempt), but because
   the display was wrong, every successful reconnect looked like a no-op.

## Fix (branch `claude/support-delegation-setup-a987c6`)

1. `src/lib/clerkPrimaryEmail.ts`: identity email now resolves the Clerk
   **primary** address; all five call sites use it.
2. `resolveDbUser`: a genuine primary-email change also re-points the user's
   own-mailbox `key_email_access` rows (delegation_id `IS NULL` only), so
   identity and key access can no longer drift apart.
3. `getGoogleToken`: when the delegation branch comes up empty, it now checks
   whether the target address is one of the key owner's own verified Clerk
   addresses (or their Google external account) and uses the owner's token —
   self-healing for rows that drifted before the fix. Fires
   `google_token_identity_fallback: true` on the tool-call event for
   observability.
4. Accounts page: shows the **actual** connected Google external account, and
   renders an explicit mismatch warning when it differs from the account
   email.

Affected users self-heal: their next dashboard visit re-syncs `users.email`
to the primary address, which already matches their key access rows. Until
then, fix 3 alone makes their MCP calls work.

## Related

- docs/bug_reports/duplicate_user_rows_break_delegation.md — same lesson
  (email is identity; treat its derivation with care).
