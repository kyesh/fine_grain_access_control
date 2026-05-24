# QA Test 11 — MCP Connection & Pending Approval Flow

## Objective
Validate the end-to-end MCP agent connection flow: OAuth → pending approval → dashboard management → tool execution.

## Prerequisites
- [ ] Dev server running (`npm run dev`)
- [ ] DB branch active (`npm run db:branch`)
- [ ] At least one proxy key created in the dashboard
- [ ] At least one email mapped to that proxy key via `key_email_access`

---

## Test 1: MCP Endpoint Discovery

**Steps:**
1. Fetch the OAuth discovery endpoint:
   ```bash
   curl -s http://localhost:3000/.well-known/oauth-authorization-server | python3 -m json.tool
   ```
2. Fetch the protected resource metadata:
   ```bash
   curl -s http://localhost:3000/.well-known/oauth-protected-resource/mcp | python3 -m json.tool
   ```

**Expected:**
- [ ] Discovery endpoint returns `authorization_endpoint`, `token_endpoint`, `registration_endpoint`
- [ ] `grant_types_supported` includes `["authorization_code", "refresh_token"]`
- [ ] Protected resource metadata returns `resource` and `authorization_servers`

---

## Test 2: Unauthenticated MCP Request Returns 401

**Steps:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/mcp \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

**Expected:**
- [ ] Returns HTTP 401
- [ ] Response includes `WWW-Authenticate` header pointing to protected resource metadata

---

## Test 3: New Agent Creates Pending Connection

**Steps:**
1. Authenticate a new agent via OAuth (use spike token or create fresh DCR client)
2. Call any tool:
   ```bash
   curl -s http://localhost:3000/api/mcp \
     -X POST -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_accounts","arguments":{}},"id":1}'
   ```

**Expected:**
- [ ] Response contains "⚠️ This connection has not been approved yet."
- [ ] Response includes dashboard URL with `?tab=connections&highlight=<id>`
- [ ] New connection appears in `/api/connections` GET response with `status: "pending"`

---

## Test 4: Dashboard Connections Panel

**Steps:**
1. Open `http://localhost:3000/dashboard`
2. Look for the "Agent Connections" section

**Expected:**
- [ ] Pending connections shown with amber border and pulse animation
- [ ] Pending card shows: client name, nickname field, proxy key selector, Approve/Block buttons
- [ ] If no connections exist, shows "No agent connections yet" message

---

## Test 5: Approve Connection in Dashboard

**Steps:**
1. For a pending connection, enter a nickname (e.g., "My Test Agent")
2. Select a proxy key from the dropdown
3. Click "✓ Approve"

**Expected:**
- [ ] Connection moves from "Pending" to "Approved" section
- [ ] Shows nickname prominently, client_name as subtitle
- [ ] Shows the bound proxy key label
- [ ] Shows "Last used" timestamp

**Verify via API:**
```bash
curl -s http://localhost:3000/api/connections | python3 -m json.tool
```
- [ ] Connection `status` is `"approved"`
- [ ] `proxyKeyId` is set
- [ ] `nickname` matches what was entered

---

## Test 6: Approved Agent Can Use Tools

**Steps:**
After approval, retry the tool call:
```bash
curl -s http://localhost:3000/api/mcp \
  -X POST -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_accounts","arguments":{}},"id":1}'
```

**Expected:**
- [ ] Returns list of accessible email accounts (from `key_email_access`)
- [ ] No "pending approval" message

---

## Test 7: get_my_permissions Shows Correct Data

**Steps:**
```bash
curl -s http://localhost:3000/api/mcp \
  -X POST -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_my_permissions","arguments":{}},"id":1}'
```

**Expected:**
- [ ] Returns connection ID and nickname
- [ ] Shows proxy key label
- [ ] Lists accessible emails
- [ ] Lists applicable rules

---

## Test 8: Block a Connection

**Steps:**
1. In the dashboard, click "Block" on an approved connection
2. Retry a tool call with the blocked agent's token

**Expected:**
- [ ] Connection appears in "Blocked" section (greyed out, strikethrough)
- [ ] Tool call returns "🚫 This connection has been blocked by the user."

---

## Test 9: Nickname Editing

**Steps:**
1. Click on an approved connection's nickname
2. Edit the nickname and press Enter or click Save

**Expected:**
- [ ] Nickname updates immediately in the UI
- [ ] API confirms: `GET /api/connections` shows updated nickname

---

## Test 10: Two Agents, Different Proxy Keys

**Steps:**
1. Create two separate DCR clients (e.g., "Agent-A" and "Agent-B")
2. Authenticate both, creating two pending connections
3. Approve Agent-A with "Restricted Agent" key
4. Approve Agent-B with "Full Access" key (if available)
5. Call `get_my_permissions` from each agent

**Expected:**
- [ ] Each agent sees its own connection and proxy key
- [ ] Each agent only has access to emails mapped to its specific proxy key
- [ ] Agents cannot see each other's connections or permissions
