# Capability: Connection Lifecycle

> Merged from `11_mcp_connection_flow.md`, `11a_mcp_server_protocol.md`, `11b_dashboard_connection_management.md`

## Assertions

### A1: Discovery endpoints return valid metadata
- Fetch `/.well-known/oauth-authorization-server`
- Fetch `/.well-known/oauth-protected-resource/mcp`
- **Expected**: Valid JSON with `authorization_endpoint`, `token_endpoint`, `registration_endpoint`

### A2: Unauthenticated MCP request returns 401
- POST to `/api/mcp` without auth
- **Expected**: HTTP 401 with `WWW-Authenticate` header

### A3: New agent creates pending connection
- Authenticate via OAuth, then call any tool
- **Expected**: Response contains "⚠️ This connection has not been approved yet." with dashboard URL

### A4: Pending connection appears in dashboard
- Check dashboard via browser agent
- **Expected**: On `/dashboard`, a warning-toned banner above the profile tabs reading
  "N agent(s) waiting for approval", AND a pending card in the **Connected Agents**
  panel with warning border + pulse animation, client name, "Pending" badge, nickname
  field, profile dropdown, and **"Attach to this profile"** / **"Block"** buttons.
- **Note**: the approve control is labelled "Attach to this profile" (paired with a
  profile selector) rather than "Approve" — it posts the same `approve` action.

### A5: Approved connection can use tools
- Attach the connection to a profile in the dashboard (select profile + nickname, click
  "Attach to this profile"), then retry tool call
- **Expected**: Tool returns actual data (e.g., email accounts), no pending message

### A6: get_my_permissions shows correct data
- Call `get_my_permissions` after approval
- **Expected**: Shows connection ID, nickname, proxy key label, accessible emails, applicable rules

### A7: Blocked connection rejected
- Detach/block an approved connection in dashboard, then retry tool call
- **Expected**: "🚫 This connection has been blocked by the user."
- **Note**: on an approved agent card the control is labelled **"Detach"**; it posts the
  same `block` action. A pending card still offers an explicit "Block" button.

### A8: Unblocked connection restored
- Unblock a blocked connection, then retry tool call
- **Expected**: Tool works again, connection back under Connected Agents for its profile
- **Note**: blocked agents appear on every profile tab (a blocked connection has no key
  binding to scope it by). The control is **"Unblock into this profile"** and re-binds the
  connection to whichever profile tab you are on.

### A9: Nickname editing works inline
- Click the agent name on an approved card, edit, press Enter (Escape cancels)
- **Expected**: Updates immediately, persists on refresh

### A10: Two agents see different permissions
- Two separate DCR clients with different proxy keys
- **Expected**: Each agent sees only its own connection and email access
