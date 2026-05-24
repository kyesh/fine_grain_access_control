# Capability: Read Blacklist Enforcement

> Extracted from `02_gmail_fine_grain_control.md` §2-3

## Assertions

### A1: Read blacklisted sender domain blocked
- Attempt to read an email from a blacklisted domain (e.g., `sales@competitor.com`)
- **Expected**: Proxy blocks with error: *"Access restricted: Sender domain '*@competitor.com' is blacklisted."*

### A2: Read blacklisted content pattern blocked
- Attempt to read an email containing blacklisted content (e.g., "CONFIDENTIAL_PROJECT_X")
- **Expected**: Proxy blocks with error including rule name: *"Access restricted: Email content blocked by rule 'Block Project X'."*

### A3: Quick-add security template blocks account lifecycle emails
- Verify emails containing "2FA Code", "Password Reset", "Verification Code" are blocked
- **Expected**: Proxy blocks with structured error: *"Access restricted: A message was received but blocked by the 'Block Account Security Emails' rule."*

### A4: Non-blacklisted emails read successfully
- Attempt to read a normal email not matching any blacklist
- **Expected**: Proxy passes the request, email content returned
