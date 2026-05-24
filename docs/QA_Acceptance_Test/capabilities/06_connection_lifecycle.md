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
- **Expected**: Amber border, pulse animation, client name, nickname field, Approve/Block buttons

### A5: Approved connection can use tools
- Approve connection in dashboard (assign proxy key + nickname), then retry tool call
- **Expected**: Tool returns actual data (e.g., email accounts), no pending message

### A6: get_my_permissions shows correct data
- Call `get_my_permissions` after approval
- **Expected**: Shows connection ID, nickname, proxy key label, accessible emails, applicable rules

### A7: Blocked connection rejected
- Block an approved connection in dashboard, then retry tool call
- **Expected**: "🚫 This connection has been blocked by the user."

### A8: Unblocked connection restored
- Unblock a blocked connection, then retry tool call
- **Expected**: Tool works again, connection back in "Approved" section

### A9: Nickname editing works inline
- Edit nickname in dashboard
- **Expected**: Updates immediately, persists on refresh

### A10: Two agents see different permissions
- Two separate DCR clients with different proxy keys
- **Expected**: Each agent sees only its own connection and email access
