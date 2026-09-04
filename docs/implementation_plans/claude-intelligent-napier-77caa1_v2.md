# Decoded-content Gmail read rules + self-identifying denials — v2

Branch: `claude/intelligent-napier-77caa1`, PR #114. Supersedes v1 (whose scope
shipped unchanged and validated 13/13 locally, A2/A6/A7 on preview). v2 adds the
**detectability** work prompted by the operator's question "could the read be
failing for some other reason, and do we have the logging to detect what she
described?" — answered in the bug report's follow-up section: three failure classes
were invisible to analytics, and one request shape hung the endpoint.

## Added scope

### src/app/api/mcp/route.ts — `withTransportObservability`

Wrapper between `experimental_withMcpAuth` and the MCP handler (so `req.auth` is
resolved and events land on the caller's person):

- POST with a JSON content-type: read a clone of the body; if it is not JSON,
  answer `400` with a JSON-RPC `-32700 Parse error` ourselves and capture
  `mcp_transport_rejected {reason: 'parse_error'}`. Fixes the hang (mcp-handler
  awaits `req.json()` unguarded and never responds).
- Any 400/404/406/415 from the handler: capture `mcp_transport_rejected
  {reason: 'sdk', status, message, rpc_methods, tool, protocol_version_header,
  client_id, user_agent}`; the response passes through untouched.
- POST `tools/call` with a 2xx: tee the response (`res.clone()`) and, in
  `after()`, scan the tee for the SDK's `isError` `-32602` results
  ("Input validation error" / "Tool X not found") → `mcp_input_validation_failed
  {tool, kind, message}`. The original stream is returned immediately; GET (SSE)
  is never buffered.

### Request fingerprint + response shape on `$mcp_tool_call`

- `gmail_read`: `message_id_hash`, `format`, `windowed` — stamped first thing, so
  denials and resolution failures carry them too.
- `gmail_get_attachment`: `message_id_hash`, `windowed`.
- Raw calls (`classifyAndStampRawCall`): `resource_id_hash` for
  `messages|threads|drafts/{id}` paths.
- `parseGmailMessage`: `parsed_body_chars`, `parsed_body_truncated`,
  `parsed_attachments`, `parsed_html_fallback` (no-op outside a wrapped call).
- Hash = `sha256(id).slice(0, 16)`, unsalted by design (`resourceIdHash` in
  `src/lib/mcpClientSignals.ts`): an operator computes it from a reported id.

### src/lib/mcpClientSignals.ts

`parseRpcEnvelope(text)` (methods + first tools/call name, never throws) and
`resourceIdHash(id)`.

### docs

`docs/monitoring.md` §7.9 (transport rejections), §7.10 (validation failures),
§7.11 (support lookup by message-id hash). Bug report follow-up section.

## Validation

Local, dev bearer against the dev server: malformed/empty JSON → 400 (was: hang);
garbage protocol version and batched initialize → 400 with events; unknown tool and
bad `gmail_read` argument types → 200 `isError` with `mcp_input_validation_failed`;
good reads carry the fingerprint props; the v1 E2E (13 assertions) still green.
Events confirmed in PostHog `environment='development'`.
