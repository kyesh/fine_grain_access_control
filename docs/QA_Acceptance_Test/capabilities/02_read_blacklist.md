# Capability: Read Blacklist Enforcement

> Extracted from `02_gmail_fine_grain_control.md` §2-3

## Assertions

### A1: Read blacklisted sender domain blocked
- Attempt to read an email from a blacklisted domain (e.g., `sales@competitor.com`)
- **Expected**: Read is blocked with a rule-named restriction message
  (*"🚫 Access restricted: Content blocked by rule '<name>'"*)
- **Mechanism note** (2026-08-16 audit): there is no separate sender-domain
  matcher — `read_blacklist` rules are one regex tested against the whole
  serialized message (`src/lib/gmailRules.ts`), so a domain pattern matches
  the From header via the same generic content path as A2, and the denial
  wording is the generic rule-named message, not a domain-specific one

### A2: Read blacklisted content pattern blocked
- Attempt to read an email containing blacklisted content (e.g., "CONFIDENTIAL_PROJECT_X")
- **Expected**: Proxy blocks with error including rule name: *"Access restricted: Email content blocked by rule 'Block Project X'."*

### A3: Quick-add security template blocks account lifecycle emails
- Verify emails containing "2FA Code", "Password Reset", "Verification Code" are blocked
- **Expected**: Proxy blocks with structured error: *"Access restricted: A message was received but blocked by the 'Block Account Security Emails' rule."*

### A4: Non-blacklisted emails read successfully
- Attempt to read a normal email not matching any blacklist
- **Expected**: Proxy passes the request, email content returned

### A5: Wildcard (`*`) patterns are expanded before matching
Patterns are globs — `*` means "anything" and every enforcement site expands it
to `.*` before compiling. This asserts the expansion actually happens at
enforcement time, in BOTH directions. A one-directional check is not enough: a
pattern that fails to compile is silently skipped, which looks identical to
"did not match".

Drive the REST proxy directly with a profile's `sk_proxy_` key (this needs only
the local dev server — no preview deploy, no MCP client):

1. Create a `read_blacklist` rule with pattern `*`, assigned to that profile.
   `GET /api/proxy/gmail/v1/users/me/messages?maxResults=1`
   → **403** `Access restricted: Email content blocked by rule '<name>'.`
   A broken expansion yields **200** here, because an uncompilable pattern is
   skipped rather than enforced.
2. Edit the same rule's pattern to `ZZZNOMATCH*` and repeat the request
   → **200**, with a real message list.

Both outcomes are required. Step 1 alone would also pass if the matcher blocked
everything unconditionally; step 2 alone would also pass if the pattern never
compiled.

**Send side**: a `send_whitelist` rule with pattern `*@allowed.example.com`,
sending to `blocked@untrusted.com`, returns **403** *"...add
'blocked@untrusted.com' to the sending whitelist."* Note this message differs
from the zero-rules case, which ends *"Default access is DENIED."* — check the
wording, since only the first proves a rule was actually evaluated. Do NOT
assert the positive send case this way; it delivers real mail.
