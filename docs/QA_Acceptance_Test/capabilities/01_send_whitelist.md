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

### A4: One-click "Enable sending to anyone" on the Default Profile
- On the dashboard's Default Profile Gmail Rules card, click
  "Enable sending to anyone" (shown while no all-recipients rule covers the
  profile)
- **Expected**: A single click creates a "Send to Anyone" send_whitelist rule
  (pattern `*`) assigned to the Default Profile; `gmail_send` to any address
  now succeeds on that profile; other profiles are unaffected; deleting the
  rule restores the deny-by-default posture and the button reappears

### A5: Wildcard rules can be created and re-saved through the form
- Create a custom rule with pattern `*@example.com`, then open the "Send to
  Anyone" rule (pattern `*`) from A4, click **Edit**, and click **Save Changes**
  without altering anything
- **Expected**: both saves succeed. No 500, no blank page. Regression guard for
  the 2026-04-10 → 2026-08-25 outage, where the dashboard validated the raw glob
  instead of its expansion and rejected every `*`-leading pattern — including
  the one the "Send to Anyone" button had just written
- Also check the rejection path: a pattern of `[` shows an inline "not a valid
  match pattern" message with the modal still open and the input preserved, and
  `(a+)+$` shows an inline "too complex" message. Neither returns a 500
