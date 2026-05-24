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
