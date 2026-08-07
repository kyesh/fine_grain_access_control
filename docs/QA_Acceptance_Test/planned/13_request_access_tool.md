# Capability: request_access Tool

> Phase D of `connector-growth_v1.md`. The agent negotiates permission
> upgrades conversationally: `request_access(capability)` mints a magic
> approval link (same machinery and security as capability 12); the human
> approves; the agent retries and succeeds. The tool grants nothing by
> itself, so it is annotated read-only.

## Assertions

### A1: Tool is listed with correct annotations
- Call `tools/list`
- **Expected**: `request_access` present with a `title`,
  `readOnlyHint: true` (it only mints a request a human must approve), and a
  factual description; `mcp-tool-lint` passes with it in the registry

### A2: Requesting send access mints a link but grants nothing
- On a profile with no send whitelist, call
  `request_access` for sending to `USER_B_EMAIL`
- **Expected**: Returns an approval URL plus a human-readable summary of
  exactly what is being requested; an immediate `gmail_send` to that address
  still fails — nothing was granted by the request itself

### A3: Approval completes the loop
- Approve the A2 link as the owning user, then have the agent retry
  `gmail_send` to `USER_B_EMAIL`
- **Expected**: Send succeeds; `get_my_permissions` now shows the whitelist
  rule scoped to this profile

### A4: Sheets write upgrade via request_access
- On a spreadsheet exposed Read-only, `request_access` for write access;
  approve choosing Read & Write; retry `sheets_append_rows`
- **Expected**: The request link names the spreadsheet; after approval the
  append succeeds; before approval it was denied

### A5: Unsupported capabilities are refused without a link
- Call `request_access` for an unsupported grant (e.g. deleting mail, or a
  non-Gmail/Sheets Google API)
- **Expected**: Refused with an explanation of what is requestable; no
  approval link is minted

### A6: request_access links obey magic-link security
- Repeat capability 12's A4 (single-use + expiry) and A5 (wrong user) checks
  against a link minted by `request_access`
- **Expected**: Identical behavior — same signing, expiry, single-use, and
  owner-session requirements
