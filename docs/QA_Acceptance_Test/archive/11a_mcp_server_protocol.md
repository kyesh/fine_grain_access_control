# QA Test 11a — MCP Server Protocol

## Objective
Validate the hosted MCP server at `/api/mcp`: discovery endpoints, authentication, tool execution, and permission enforcement.

## Prerequisites
- [ ] Dev server running (`npm run dev`) or Vercel preview deployed
- [ ] DB branch active (`npm run db:branch`) if local
- [ ] At least one proxy key with email mapped via `key_email_access`
- [ ] A valid OAuth token for an approved agent connection

---

## Test 1: MCP Endpoint Discovery

**Steps:**
1. Fetch the OAuth discovery endpoint:
   ```bash
   curl -s $BASE_URL/.well-known/oauth-authorization-server | python3 -m json.tool
   ```
2. Fetch the protected resource metadata:
   ```bash
   curl -s $BASE_URL/.well-known/oauth-protected-resource/mcp | python3 -m json.tool
   ```

**Expected:**
- [ ] Discovery endpoint returns `authorization_endpoint`, `token_endpoint`, `registration_endpoint`
- [ ] `grant_types_supported` includes `["authorization_code", "refresh_token"]`
- [ ] Protected resource metadata returns `resource` and `authorization_servers`

---

## Test 2: Unauthenticated MCP Request Returns 401

**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" $BASE_URL/api/mcp \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

**Expected:**
- [ ] Returns HTTP 401
- [ ] Response includes `WWW-Authenticate` header pointing to protected resource metadata

---

## Test 3: New Agent Creates Pending Connection

**Steps:**
1. Authenticate a new agent via OAuth (create fresh DCR client)
2. Call any tool:
   ```bash
   curl -s $BASE_URL/api/mcp \
     -X POST -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -H "Authorization: Bearer $NEW_AGENT_TOKEN" \
     -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_accounts","arguments":{}},"id":1}'
   ```

**Expected:**
- [ ] Response contains "⚠️ This connection has not been approved yet."
- [ ] Response includes dashboard URL with `?tab=connections&highlight=<id>`
- [ ] New connection appears in `/api/connections` with `status: "pending"`

---

## Test 4: Approved Agent Can Use Tools

**Steps:**
After approval in dashboard, retry the tool call:
```bash
curl -s $BASE_URL/api/mcp \
  -X POST -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $APPROVED_TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_accounts","arguments":{}},"id":1}'
```

**Expected:**
- [ ] Returns list of accessible email accounts (from `key_email_access`)
- [ ] No "pending approval" message

---

## Test 5: get_my_permissions Shows Correct Data

**Steps:**
```bash
curl -s $BASE_URL/api/mcp \
  -X POST -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $APPROVED_TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_my_permissions","arguments":{}},"id":1}'
```

**Expected:**
- [ ] Returns connection ID and nickname
- [ ] Shows proxy key label
- [ ] Lists accessible emails
- [ ] Lists applicable rules

---

## Test 6: Blocked Agent Rejected

**Steps:**
After blocking a connection in the dashboard, retry:
```bash
curl -s $BASE_URL/api/mcp \
  -X POST -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $BLOCKED_TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_accounts","arguments":{}},"id":1}'
```

**Expected:**
- [ ] Returns "🚫 This connection has been blocked by the user."
- [ ] No email data returned

---

## Test 7: Two Agents, Different Proxy Keys

**Steps:**
1. Create two separate DCR clients ("Agent-A" and "Agent-B")
2. Authenticate both, creating two pending connections
3. Approve Agent-A with "Restricted Agent" key
4. Approve Agent-B with a different key
5. Call `get_my_permissions` from each agent

**Expected:**
- [ ] Each agent sees its own connection and proxy key
- [ ] Each agent only has access to emails mapped to its specific proxy key
- [ ] Agents cannot see each other's connections or permissions
