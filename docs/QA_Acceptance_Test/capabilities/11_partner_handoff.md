# Capability: Partner Handoff

> Third-party apps registered in `partner_apps` hand their signed-in users to
> FGAC's `/oauth/authorize` consent interstitial, receive OAuth credentials via
> Clerk, and exchange them for the connection's proxy key. Implemented on branch
> `claude/third-party-handoff-permissions-81dc96`; design in
> `docs/implementation_plans/third-party-handoff-permissions_v6.md`.
>
> **Setup**: requires `setup/04_partner_app_registration.md` (registers the QA
> partner app and records its credentials in `qa-test-agents.json`).
>
> **Channels**: A2–A4 and A9 are browser-agent assertions; the rest run via
> curl. Primary runbook: `agents/01_hosted_mcp.md`. The other agent runbooks
> mark this capability channel-inapplicable (the handoff is a browser + REST
> surface, not an agent-runtime surface).

## Assertions

### A1: Unknown client_id rejected
- GET `/oauth/authorize?client_id=bogus&redirect_uri=https://example.com/cb` (signed in)
- **Expected**: "Unknown application" error page. No key, rule, or connection
  row created; no redirect to the given redirect_uri.

### A2: Consent interstitial renders registry data
- GET `/oauth/authorize` with the QA partner app's client_id + registered
  redirect_uri, signed in as USER_A
- **Expected**: page shows partner name, permission summary derived from the
  manifest (read-only email + notifications lines), a mailbox picker
  defaulting to USER_A's address, Approve and Deny buttons. Nothing from the
  query string is echoed except through registry validation.

### A3: Deny provisions nothing
- Click **Deny**
- **Expected**: 303 to the partner redirect_uri with `error=access_denied` and
  the original `state`. No proxy key, no rules, no connection row.

### A4: Approve provisions everything in one step
- Re-open the authorize URL, click **Approve**
- **Expected**: browser lands on the partner redirect_uri with `code` + `state`
  (Clerk's consent screen NEVER appears — the app is registered with
  `consent_screen_enabled=false`). Dashboard/DB now show: a proxy key labeled
  with the partner name; `key_email_access` for the selected mailbox; an
  `agent_connections` row `approved`, bound to that key, with `partnerAppId`
  and `manifestVersion` set.

### A5: Code exchange yields working tokens immediately
- Exchange the code at Clerk's token endpoint (PKCE verifier from setup)
- **Expected**: access + refresh tokens returned; an MCP `list_accounts` call
  with the access token returns data with NO pending-approval step; the
  refresh_token grant returns a fresh (rotated) pair.

### A6: Partner token exchange returns the proxy key
- POST `/api/auth/partner-token` with `Authorization: Bearer <access token>`
- **Expected**: `status: approved`, `sk_proxy_...` key, the selected mailbox in
  `emails`. A REST proxy `gmail/v1/users/me/messages?maxResults=1` call with
  that key succeeds.

### A7: Interstitial bypass fails safe
- Using a DCR client (NOT the partner app), or the partner client_id driven
  straight at Clerk's own `/oauth/authorize` URL for a user who never saw the
  FGAC interstitial: obtain tokens, call an MCP tool
- **Expected**: connection is created `pending`; tool calls return the
  awaiting-approval message. Silent token issuance NEVER implies provisioned
  access. (Spike 1 finding — must stay true forever.)

### A8: Read-only default enforced
- With the partner's proxy key (manifest `access: read_only`, no rule
  templates): attempt `gmail_send` via MCP and `messages/send` via REST proxy
- **Expected**: both denied (deny-by-default send whitelist), reads still work.

### A9: Dashboard shows partner provenance; Detach kills both paths
- Dashboard → Connected Agents: the partner connection card shows a
  "Partner · <name>" badge. Click **Detach**, then retry (a) an MCP tool call
  with the OAuth token and (b) a REST proxy call with the proxy key
- **Expected**: badge visible before; after detach both calls are refused
  (blocked/pending — the key binding is dropped).

### A10: Manifest bump cannot widen an existing grant
- Re-run `scripts/register-partner-app.ts` for the QA partner with a changed
  manifest (bumps `manifestVersion` in the registry)
- **Expected**: the existing connection's `manifestVersion` is unchanged (still
  the consented version); its key/rules are untouched. Rules for the
  connection only change after a fresh consent pass.
