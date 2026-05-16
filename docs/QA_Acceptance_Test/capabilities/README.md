# Capabilities — Assertion Checklists

> **These are NOT standalone tests.** They define WHAT to verify, not HOW.
> Each assertion is executed through an agent interface doc in `agents/` or `production/`.

## How to Use

1. Each capability doc lists assertions with expected outcomes.
2. Agent docs (`agents/01_hosted_mcp.md`, etc.) describe how to execute these assertions in a specific runtime.
3. Every agent doc must cover every capability.
4. When adding a new capability file here, update ALL agent docs to cover it.

## Capabilities

| # | File | What It Tests |
|---|------|---------------|
| 01 | `01_send_whitelist.md` | Whitelisted send succeeds, blocked send returns 403 |
| 02 | `02_read_blacklist.md` | Content-based read blocking, rule names in errors |
| 03 | `03_multi_email_scoping.md` | Key-to-email isolation, power key multi-access |
| 04 | `04_delegation.md` | Cross-user delegated email access |
| 05 | `05_label_access.md` | Label whitelist/blacklist filtering |
| 06 | `06_connection_lifecycle.md` | Pending → approve → block → unblock → nickname |
| 07 | `07_key_lifecycle.md` | Revoke, roll, cross-user isolation |
| 08 | `08_strict_light_mode.md` | No dark mode leaks regardless of OS preference |
