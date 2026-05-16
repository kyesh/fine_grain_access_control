# Capability: Label-Based Access Control

> Extracted from `05_gmail_label_based_access.md`

## Assertions

### A1: Label search populates from real Gmail labels
- When creating a label rule, the UI shows actual Gmail labels from the user's account
- **Expected**: Labels like `INBOX`, `TRASH`, and custom labels appear in the selector

### A2: Whitelisted label allows read
- Agent reads an email with the whitelisted label (e.g., `AI-Allowed`)
- **Expected**: Proxy passes the request, email read successfully

### A3: Non-whitelisted label blocked when whitelist active
- Agent reads an email WITHOUT the whitelisted label
- **Expected**: Proxy blocks with error: *"Access restricted: Email lacks the required whitelisted label 'AI-Allowed'."*

### A4: Blacklisted label blocks read
- Agent reads an email with a blacklisted label (e.g., `Highly-Confidential`)
- **Expected**: Proxy blocks with error: *"Access restricted: Email contains blacklisted label 'Highly-Confidential'."*

### A5: Blacklist takes precedence over whitelist
- Email has BOTH a whitelisted AND blacklisted label
- **Expected**: Blocked — blacklist wins

### A6: List queries omit blacklisted emails
- Agent lists recent emails when a label blacklist is active
- **Expected**: Emails with blacklisted labels are excluded from results
