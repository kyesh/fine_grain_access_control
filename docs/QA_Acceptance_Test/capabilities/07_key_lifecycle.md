# Capability: Key Lifecycle

> Extracted from `03_multi_email_multi_key.md` §7-9

## Assertions

### A1: Revoked key immediately rejected
- Revoke a key in the dashboard, then attempt any API call with it
- **Expected**: 401 Unauthorized. Other keys unaffected.

### A2: Revoked key shows timestamp in dashboard
- Check the dashboard after revocation
- **Expected**: Key marked as "Revoked" with timestamp for auditing

### A3: Key rolling generates new value atomically
- Roll a key — note old value, get new value
- **Expected**: New key value generated, old key immediately stops working

### A4: Rolled key inherits permissions
- After rolling, verify email access grants and rule assignments transfer
- **Expected**: New key has same email access + rules as old key

### A5: Cross-user key isolation
- User B obtains/guesses User A's proxy key value
- **Expected**: Key authenticates as User A's agent, but User B cannot modify User A's rules or dashboard. Keys are opaque bearer tokens tied to the issuing user.

### A6: Cross-user dashboard isolation
- Log in as a different user
- **Expected**: No visibility into other users' keys, emails, or rules
