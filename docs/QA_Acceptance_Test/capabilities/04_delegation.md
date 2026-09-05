# Capability: Email Delegation

> Extracted from `04_email_delegation.md` §1-10

## Assertions

### A1: Own email accessible without delegation
- Access own email with a key that has it mapped
- **Expected**: Success — no delegation setup needed

### A2: Delegated email accessible via proxy
- Owner delegates their email to another user. Delegate creates key with access to owner's email.
- Access delegated email through the proxy
- **Expected**: Success — proxy fetches owner's Google token via Clerk

### A3: Access rules work on delegated emails
- Delegate creates a read_blacklist rule scoped to the delegated email
- **Expected**: Rule blocks content on delegated email but not on delegate's own email

### A4: Revoked delegation immediately cuts access
- Owner revokes the delegation
- Delegate attempts to access the owner's email
- **Expected**: 403 Forbidden — delegation revoked

### A5: Delegation is data-plane only
- Delegate cannot see owner's keys, rules, or dashboard settings
- **Expected**: Complete control-plane isolation

### A6: list_accounts shows delegated emails
- Agent calls list_accounts
- **Expected**: Returns both own and delegated email addresses

### A7: Default Profile auto-includes delegated mailboxes
- Owner delegates to a user who has a Default Profile connection but takes NO
  dashboard action as the delegate (no key creation, no profile edit)
- On that default-profile connection, call `list_accounts`, then `gmail_list`
  with `account=<owner email>`
- **Expected**: The owner's mailbox is listed and readable immediately —
  delegation alone attaches it to the Default Profile. After the owner
  revokes, the same calls are denied and the mailbox disappears from
  `list_accounts` (custom profiles remain per-mailbox opt-in at creation)

### A8: list_accounts reports per-account Google scope state
- Agent calls list_accounts on a key with at least one own and one delegated
  mailbox
- **Expected**: The response carries `account_details` alongside the
  unchanged `accounts` string array — one entry per account with `email`,
  `delegated`, `google_token` (`ok` / `unavailable` / `unknown`, plus
  `google_token_failure` naming the class when `unavailable`), and three-state
  `gmail` / `drive_file` values
  (`granted`/`missing`/`unknown`; a scope Clerk cannot report is `unknown`,
  never coerced to `missing`). A healthy QA account reports `google_token:
  'ok'` and both scopes `granted` with no `reconnect_url`; an account with a
  missing scope (or a token failure that cannot clear on its own —
  `no_token` / `refresh_failed`) carries a `reconnect_url` ending in
  `?reconnect=1&for=<that account's email>` (URL-encoded — the link is bound
  to the account it repairs) and a `reconnect_by` that, for a delegated
  mailbox, names the OWNER as the one who must open it signed in as that
  account; a transient token failure, a timed-out probe, a missing owner
  account (`google_token_failure: 'owner_not_found'` — what every delegated
  mailbox reports on a Vercel preview, whose database is a copy of production
  with production Clerk ids), or an inactive delegation carries NO link. `next_steps.sheets`/`next_steps.docs` point at
  the link when `drive_file` is `missing`
