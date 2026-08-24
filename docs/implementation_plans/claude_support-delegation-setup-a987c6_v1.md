# Fix: identity-email drift breaks own-mailbox token lookup

Branch: `claude/support-delegation-setup-a987c6` · Revision 1 · 2026-08-24

## Trigger

Support case (2026-08-24, support@fgac.ai): a user's every Sheets call fails with
"Could not fetch Google token for '<their-email>'", their proxy key lists their
own address as the only accessible email, yet the Accounts page shows a
*different* address as the Connected Google Account, and "Reconnect Google"
appears to do nothing.

## Verified root cause (production, read-only)

The user's Clerk account holds:

- primary email: their workspace address (call it `own@work.tld`)
- a second verified address added later (`personal@gmail.com`)
- exactly one Google external account — `own@work.tld`, verified, refreshable
  (its `updated_at` bumps on every "Reconnect", i.e. reconnect was succeeding)

The FGAC DB holds `users.email = personal@gmail.com` while the Default
Profile's `key_email_access` row is `own@work.tld`.

Chain of causes:

1. **`users.email` is derived from `clerkUser.emailAddresses[0]`** in five call
   sites. Clerk's array order is not the primary email; when a second address
   is added it can land at index 0.
2. **`resolveDbUser` drift-syncs `users.email`** to whatever it is handed, so a
   dashboard page load silently re-keyed the user's identity to the second
   address. `key_email_access` was not updated, so the key's own-mailbox row
   kept the original address.
3. **`getGoogleToken` decides own-vs-delegated by `targetEmail ===
   keyOwner.email`**. After the drift, the user's own mailbox no longer equals
   `users.email`, so it takes the delegation branch, finds no user row / no
   delegation for the address, and returns null — the generic "could not fetch
   token" error — even though a valid Clerk token for exactly that address
   exists on the key owner.
4. **The Accounts page labels `dbUser.email` as the "Connected Google
   Account"** — it never reads the actual external account — so the user was
   shown the wrong account and steered into a futile reconnect loop.

## Changes

1. `src/lib/clerkPrimaryEmail.ts` (new): resolve a Clerk user's primary email
   (`primaryEmailAddress` → `primaryEmailAddressId` lookup → `[0]` fallback).
   Replace `emailAddresses[0]` at the five identity call sites:
   `api/mcp/route.ts`, `dashboard/page.tsx`, `dashboard/accounts/page.tsx`,
   `oauth/authorize/page.tsx`, `api/partner/consent/route.ts`.
2. `resolveDbUser`: when the email genuinely changes, also re-point the user's
   own-mailbox `key_email_access` rows (delegation_id IS NULL, target = old
   email) on their keys, so key access follows identity.
3. `getGoogleToken`: before failing the delegated branch, check whether
   `targetEmail` is one of the key owner's own verified Clerk addresses (or
   their Google external account email); if so, use the owner's token. This
   makes own-mailbox lookups robust to any residual identity drift.
4. Accounts page: display the *actual* Google external account email; when it
   differs from the accessible/primary address, render an explicit mismatch
   warning instead of implying the wrong account is connected.

## Self-healing for the affected user

Once deployed, the user's next dashboard visit resolves the primary email
(`own@work.tld`), `resolveDbUser` flips `users.email` back, and the existing
`key_email_access` row already matches — no data surgery needed. Until they
visit, change 3 alone already fixes their MCP calls.

## QA

- `npx tsc --noEmit`
- Local UI: Accounts page renders connected-account email and mismatch banner.
- MCP flow exercised via preview deployment per `/deploy-pr-preview`.
