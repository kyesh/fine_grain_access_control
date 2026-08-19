# Capability: Raw Google API Pair (Deny-by-Default)

> Covers the `google_api_get` / `google_api_modify` MCP tools that replaced
> `raw_google_api_call` for Anthropic Connectors Directory compliance
> (no single tool may mix safe and unsafe HTTP methods). Classification lives
> in `src/app/api/mcp/googleApiPolicy.ts`; enforcement must be identical to
> the dedicated tools. Hosted-MCP interface only (the REST proxy at
> `/api/proxy` is a separate surface).

## Assertions

### A1: Raw pair is annotated; legacy tool is gone; descriptions state the real access model
- Call `tools/list` on the hosted MCP endpoint
- **Expected**: `google_api_get` present with `readOnlyHint: true`;
  `google_api_modify` present with `destructiveHint: true`; every listed tool
  has a `title`; `raw_google_api_call` is absent; `google_api_modify`'s input
  schema offers only POST/PUT/PATCH (no DELETE, no GET)
- **Also expected** (description accuracy, 2026-08-15 tester finding):
  `google_api_get` and `gmail_read` descriptions state that Gmail reads are
  allowed by default and filtered by read-block rules (not that every
  response is rule-gated), and `gmail_get_attachment`'s description states
  the returned data is base64url-encoded (URL-safe alphabet, padded — a
  15,326-byte fixture ends in exactly one "=", verified 2026-08-16; the
  description must match the actual output, per the tester finding)

### A2: Raw Gmail read succeeds
- `google_api_get` with path `gmail/v1/users/me/messages?maxResults=2`
- **Expected**: Real Gmail message list JSON (ids), no error

### A3: Unknown Google API passes through with classification
- `google_api_get` with path `drive/v3/files`
- **Expected**: The call is forwarded to Google with the account's token
  (2026-08-19 posture change: classify, not block — Google's OAuth scopes are
  the backstop). With the standard grant, drive.file limits results to
  picked/app-created files. The `$mcp_tool_call` event carries
  `raw_api_passthrough: true` and `raw_api_family: 'drive/v3'`.

### A4: Non-send Gmail write is denied
- `google_api_modify` with path `gmail/v1/users/me/messages/<any-id>/modify`
- **Expected**: Denied with a message that only `messages/send` is a
  supported Gmail write

### A5: Raw send to non-whitelisted recipient is denied
- `google_api_modify` to `gmail/v1/users/me/messages/send` with a base64url
  RFC 2822 `raw` body addressed to `blocked@untrusted.com`
- **Expected**: Unauthorized-recipient denial (recipient parsed out of the
  raw message); nothing is sent

### A6: Raw send to whitelisted recipient succeeds
- `google_api_modify` to `gmail/v1/users/me/messages/send` with a `raw` body
  addressed to a whitelisted address (e.g. `USER_B_EMAIL`)
- **Expected**: Gmail returns a real message id; the mail is actually sent

### A7: Raw send with unparseable recipients is denied
- `google_api_modify` to `gmail/v1/users/me/messages/send` with a body that
  has no parseable To/Cc/Bcc (e.g. `{"raw": "!!!"}` or a missing `raw`)
- **Expected**: Denied with a could-not-determine-recipients message (deny on
  parse failure, never forward blind)

### A8: Raw Sheets write honors per-spreadsheet rules
- `google_api_modify` PUT to
  `v4/spreadsheets/<exposed-id>/values/<range>?valueInputOption=USER_ENTERED`
- **Expected**: Succeeds when the spreadsheet's rule is Read & Write; denied
  with the read-only message when the rule is Read Only (toggle via dashboard
  UI, as in capability 09 A8)

### A9: Batch is denied (and monitored); sheet creation is allowed and auto-granted
- `google_api_modify` with path `batch/gmail/v1`; and `google_api_modify`
  POST with path `v4/spreadsheets` with body `{"properties":{"title":"QA created sheet"}}`
- **Expected**: Batch is denied (it could smuggle sub-requests past the send
  whitelist and read restrictions) and the attempt is stamped
  `denial_code: 'raw_api_batch_unsupported'` for demand monitoring. The
  spreadsheet creation SUCCEEDS (2026-08-19 posture change), returns the new
  spreadsheet JSON, auto-creates a read & write rule for the new id scoped to
  the calling key (visible in dashboard rules as "Agent-created: …"), and a
  follow-up `sheets_read_range` on the new id succeeds without any approval
  link. An `agent_sheet_created` event fires with `auto_granted: true`.
