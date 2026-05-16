# Agent: Hosted MCP Server

> Runs ALL capabilities via curl against the MCP endpoint.
> Package #1 from distribution_architecture.md.

## Prerequisites
- `/qa-setup` completed (keys, rules, emails configured)
- Dev server running at `$BASE_URL` (default: `http://localhost:3000`)
- Fresh DCR client registered and approved in dashboard

## Auth Setup

1. Register a Dynamic Client:
   ```bash
   REG_ENDPOINT=$(curl -sf $BASE_URL/.well-known/oauth-authorization-server | jq -r '.registration_endpoint')
   DCR=$(curl -sf $REG_ENDPOINT -X POST -H "Content-Type: application/json" \
     -d '{"client_name":"QA Hosted MCP Test","redirect_uris":["http://localhost:9999/callback"],"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none"}')
   CLIENT_ID=$(echo $DCR | jq -r '.client_id')
   ```
2. Complete OAuth flow (via browser agent) to get access token
3. Approve connection in dashboard — assign proxy key

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
