# Capability: Label-Based Access Control

> Extracted from `05_gmail_label_based_access.md`

## Enforcement policy (applies to every assertion)

**Read-time enforcement, uniform across interfaces.** Label whitelist/blacklist and
content blacklist rules restrict access when message CONTENT is read — and they must
behave identically on the hosted MCP tools (`gmail_read`, `gmail_get_attachment`) and
the raw API proxy. Emails MAY appear in list results (ids/metadata) regardless of
label rules; appearing in a list is not access. Assertions A2–A5 must therefore be
verified on BOTH interfaces.

## Assertions

### A1: Label search populates from real Gmail labels
- When creating a label rule, the UI shows actual Gmail labels from the user's account
- **Expected**: Labels like `INBOX`, `TRASH`, and custom labels appear in the selector

### A2: Whitelisted label allows read
- Agent reads an email with the whitelisted label (e.g., `AI-Allowed`) — via MCP and via the raw API
- **Expected**: Request passes on both interfaces, email read successfully

### A3: Non-whitelisted label blocked when whitelist active
- Agent reads an email WITHOUT the whitelisted label — via MCP and via the raw API
- **Expected**: Both interfaces block with an "Access restricted: Email lacks a required whitelisted label" error

### A4: Blacklisted label blocks read
- Agent reads an email with a blacklisted label (e.g., `Highly-Confidential`) — via MCP and via the raw API
- **Expected**: Both interfaces block with an "Access restricted: Email contains blacklisted label …" error

### A5: Blacklist takes precedence over whitelist
- Email has BOTH a whitelisted AND blacklisted label — read via both interfaces
- **Expected**: Blocked on both — blacklist wins

### A6: Listing may include restricted emails; reading them stays blocked
- Agent lists recent emails while a label blacklist is active, then attempts to read a listed blacklisted email
- **Expected**: The listing succeeding (with or without the restricted email present) is
  NOT a failure — Google-native list behavior is not overridden. The read attempt on the
  blacklisted email is blocked on both interfaces. (The raw-API proxy additionally
  filters list queries via Gmail search operators; that is defense in depth, not a
  required behavior.)
