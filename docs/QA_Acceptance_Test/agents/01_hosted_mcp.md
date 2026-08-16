# Agent: Hosted MCP Server

> Runs ALL capabilities via curl against the MCP endpoint.
> Package #1 from distribution_architecture.md.

## Environment Setup

1. **Run reset**: `bash test/qa-envs/hosted-mcp/reset.sh`
2. Ensure dev server is running at `$BASE_URL` (default: `http://localhost:3000`)
3. Ensure `/qa-setup` is completed (keys, rules, emails configured)
4. Proceed to Auth flow (DCR registration via curl, saving tokens to `test/qa-envs/hosted-mcp/state.json`)

## Auth Setup

1. Register a Dynamic Client:
   ```bash
   REG_ENDPOINT=$(curl -sf $BASE_URL/.well-known/oauth-authorization-server | jq -r '.registration_endpoint')
   DCR=$(curl -sf $REG_ENDPOINT -X POST -H "Content-Type: application/json" \
     -d '{"client_name":"QA Hosted MCP Test","redirect_uris":["http://localhost:9999/callback"],"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none"}')
   CLIENT_ID=$(echo $DCR | jq -r '.client_id')
   ```
2. Complete OAuth flow (via `/browser-agent`) to get access token
3. Approve connection via `/browser-agent`:
   - Navigate to `$BASE_URL/dashboard?tab=connections`
   - Find the pending connection for this client
   - Select a proxy key from the dropdown and click **Approve**
   - ⚠️ **NEVER approve connections via direct DB writes — always use the Web UI**

## Proof of Authenticity

> The following evidence proves the real MCP runtime processes requests:

- [ ] Raw `curl` output captured showing full HTTP request/response
- [ ] Response headers include `x-mcp-session-id`
- [ ] Auth went through full OAuth DCR → token → MCP endpoint chain (not a static key)

---

## Capability: Send Whitelist (→ capabilities/01_send_whitelist.md)

### A1: Send to whitelisted address
```bash
curl -s $BASE_URL/api/mcp -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"gmail_send","arguments":{"to":"'$USER_B_EMAIL'","subject":"QA Hosted MCP - Send Whitelist A1","body":"Test from hosted MCP"}},"id":1}'
```
- [ ] Send succeeds

### A2: Send to blocked address
```bash
curl -s $BASE_URL/api/mcp -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"gmail_send","arguments":{"to":"blocked@untrusted.com","subject":"Blocked","body":"Test"}},"id":1}'
```
- [ ] Returns error: "Unauthorized email address"

### A3: get_my_permissions shows send whitelist
```bash
curl -s $BASE_URL/api/mcp -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_my_permissions","arguments":{}},"id":1}'
```
- [ ] Shows send whitelist rules

---

## Capability: Read Blacklist (→ capabilities/02_read_blacklist.md)

### A1: Read blacklisted sender domain
```bash
curl -s $BASE_URL/api/mcp -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"gmail_read","arguments":{"query":"from:sales@competitor.com"}},"id":1}'
```
- [ ] Returns "Access restricted"

### A4: Non-blacklisted email reads successfully
```bash
curl -s $BASE_URL/api/mcp -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"gmail_list","arguments":{}},"id":1}'
```
- [ ] Returns email list

---

## Capability: Multi-Email Scoping (→ capabilities/03_multi_email_scoping.md)

### A1: Key accesses mapped email
```bash
curl -s $BASE_URL/api/mcp -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_accounts","arguments":{}},"id":1}'
```
- [ ] Returns exactly the emails mapped to this proxy key

### A2: Key blocked from unmapped email
```bash
curl -s $BASE_URL/api/mcp -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"gmail_list","arguments":{"account":"unmapped@other.com"}},"id":1}'
```
- [ ] Returns error: email not accessible

---

## Capability: Delegation (→ capabilities/04_delegation.md)

### A6: list_accounts shows delegated emails
- [ ] Returns both own and delegated email

---

## Capability: Connection Lifecycle (→ capabilities/06_connection_lifecycle.md)

### A1-A2: Discovery and 401
- [ ] Discovery endpoints valid (tested during auth setup)
- [ ] Unauthenticated request returns 401

### A3-A5: Pending → Approve → Tools work
- [ ] Pending connection created during auth
- [ ] Approved via dashboard
- [ ] Tools return data after approval

### A6: get_my_permissions
- [ ] Shows connection ID, nickname, key, emails, rules

### A7: Block → rejected
- [ ] Tool call returns "blocked" message

---

## Capability: Key Lifecycle (→ capabilities/07_key_lifecycle.md)

### A1: Revoked key rejected
- [ ] 401 with revoked key

---

## Capability: Label Access (→ capabilities/05_label_access.md)

- [ ] Whitelisted label allows read
- [ ] Blacklisted label blocks read

---

## Capability: Light Mode (→ capabilities/08_strict_light_mode.md)

> Tested via browser agent — same for all agents. See capability doc.

- [ ] Light mode enforced regardless of OS preference

## Capability: Partner Handoff (→ capabilities/11_partner_handoff.md)

> Primary runbook for this capability. Prereq: `setup/04_partner_app_registration.md`.

- Build the authorize URL from `qa-test-agents.json` → `qa_partner` (client_id,
  PKCE challenge, redirect_uri `http://localhost:3000/oauth/callback`).
- A1: bogus client_id via browser agent → error page.
- A2–A4: browser agent as USER_A — interstitial render, Deny round-trip,
  Approve → callback lands with `code` (the QA `/oauth/callback` route
  auto-exchanges and saves `qa-token-<client_id>.json`).
- A5: token file has refresh_token; `curl /api/mcp` `list_accounts` with the
  access token → data, no pending. Refresh grant against the Clerk token URL.
- A6: `curl -X POST /api/auth/partner-token -H "Authorization: Bearer <at>"` →
  `sk_proxy_...`; then `curl /gmail/v1/users/me/messages?maxResults=1` with it.
- A7: use a plain DCR client (`scripts/qa-dcr-setup.ts`) driven straight at the
  Clerk authorize URL → MCP call returns pending.
- A8: `gmail_send` via MCP + `messages/send` via proxy with the partner key →
  both 403/denied.
- A9: browser agent — partner badge on the connection card; Detach; re-try MCP
  + proxy calls → refused.
- A10: re-run `register-partner-app.ts` with a changed manifest; verify
  connection's pinned `manifestVersion` and rules unchanged.

## Capability: Push Notifications (→ capabilities/12_push_notifications.md)

> Server-side capability — run ONCE per QA cycle from this runbook. Prereqs:
> setup/04 complete, receiver + bridge running, dev server restarted after
> `setup-gmail-push.ts` wrote env vars.

- A1: after the cap-11 Approve, query the dashboard/DB state via
  `get_my_permissions` + `qa-webhook-log.json` baseline; subscription active.
- A2/A3: `gmail_send` a self-email to USER_A (whitelist it first or send via
  Gmail API using the vaulted token per spike method); bridge drains; assert
  the receiver log entry (signature_valid=true, ids-only payload).
- A4: add label blacklist rule via dashboard; labeled email → no ping;
  unlabeled control email → ping.
- A5: re-run `setup-gmail-push.ts --apply` (re-arms nothing) or re-arm watch;
  assert `enqueued=0` behavior on the arm-time notification.
- A6: re-POST the last drained envelope with the bridge secret → `enqueued: 0`.
- A7/A8: touch `qa-webhook-fail`; email; drain; call
  `/api/cron/deliver-webhooks` to walk the ladder; verify dead + suspension;
  remove flag, re-enable, verify recovery.
- A9: age `watchExpiresAt`; GET `/api/cron/renew-watches`; verify advance.
- A10: Detach via browser agent; email again → silence.
- A11: unauthenticated POST to `/api/webhooks/gmail` → 401.
- A12: `setup-gmail-push.ts --project dev-fgac-ai` dry run → all ✔.

## Capability: Analytics Events (→ capabilities/16_analytics_events.md)

> Run LAST — it inspects the PostHog events the capabilities above generated.
> Environment tier here is `development` (localhost dev server).

- A1–A5: `npx tsx scripts/qa-posthog-events.ts --event '$mcp_tool_call' --since <minutes since run start> --environment development`
  (A2 repeats with `--event mcp_tool_call` expecting 0 rows). Needs
  `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID`; if unset, `skip` all with
  that reason. Ingestion lags ~30–60s — re-query before failing.
- A6: via the browser agent, click a sign-up CTA signed-out (never complete
  sign-up), then query `--event sign_up_started`. Headless-only run → `skip`.
