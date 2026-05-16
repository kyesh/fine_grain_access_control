# Capability: Multi-Email Scoping

> Extracted from `03_multi_email_multi_key.md` §3-6

## Assertions

### A1: Key-A can access its mapped email
- Using QA-Agent-A key, access `USER_A_EMAIL` inbox
- **Expected**: Successful response with message data

### A2: Key-A cannot access unmapped email
- Using QA-Agent-A key, access `USER_B_EMAIL` inbox
- **Expected**: 403 Forbidden — *"This API key does not have access to 'USER_B_EMAIL'."*

### A3: Key-B can access its mapped email
- Using QA-Agent-B key, access `USER_B_EMAIL` inbox
- **Expected**: Successful response

### A4: Power key can access both emails
- Using QA-Power-Agent key, access both `USER_A_EMAIL` and `USER_B_EMAIL`
- **Expected**: Both return successful responses

### A5: Global rule applies to all keys
- A global read_blacklist rule (no key assignment) blocks content for all keys
- **Expected**: Same content blocked regardless of which key is used

### A6: Key-specific rule applies only to assigned key
- A rule assigned to QA-Agent-B blocks content only when using that key
- Using QA-Power-Agent to read the same content succeeds
- **Expected**: Rule enforced only on the assigned key
