# Capability: Send Whitelist Enforcement

> Extracted from `02_gmail_fine_grain_control.md` §1

## Assertions

### A1: Send to whitelisted address succeeds
- Send an email to an address on the send whitelist (e.g., `USER_B_EMAIL` or `allowed@example.com`)
- **Expected**: Proxy passes the request, email sent successfully

### A2: Send to blocked address returns 403
- Send an email to an address NOT on the send whitelist (e.g., `blocked@untrusted.com`)
- **Expected**: Proxy blocks with clear error: *"Unauthorized email address. Please ask your user to add 'blocked@untrusted.com' to the sending whitelist."*

### A3: get_my_permissions shows send whitelist rules
- Query the agent's permissions
- **Expected**: Send whitelist rules visible in the response
