---
name: fgac.ai Gmail Proxy
description: Secure Gmail access for Claude Code via FGAC.ai proxy — supports both MCP and API key modes.
---

# Claude Code: fgac.ai Gmail Configuration

This skill enables Claude Code to interact with Gmail securely via the fgac.ai proxy, enforcing fine-grained access control rules defined by the user.

## Setup Options

### Option A: MCP Server (Recommended)

Add the FGAC.ai MCP server to Claude Code:

```bash
claude mcp add --transport http fgac-gmail https://gmail.fgac.ai/api/mcp
```

After running:
1. Claude Code will discover OAuth endpoints automatically
2. A browser window opens for you to sign in with your Google account
3. After consent, the first tool call shows: **"⚠️ Pending approval"**
4. Visit the linked dashboard URL to approve this agent and assign it a proxy key (agent profile)
5. Once approved, all Gmail tools work with the permissions you configured

**Available MCP tools:**
- `list_accounts` — See which email accounts this agent can access
- `gmail_list` — List emails with optional search query
- `gmail_read` — Read a specific email by message ID
- `gmail_send` — Send email (subject to send whitelist rules)
- `gmail_labels` — List Gmail labels
- `get_my_permissions` — Show current access rules and permissions

### Option B: API Key Mode

1. Obtain a Proxy Key (`sk_proxy_...`) from `https://fgac.ai/dashboard`
2. Set the environment variable: `export FGAC_PROXY_KEY=sk_proxy_...`

## Instructions for Claude Code

When the user asks you to interact with Gmail:

1. **Never use standard Google `credentials.json` or OAuth flows for Gmail.**
2. **Override the API Endpoint**: All requests must be routed through `https://gmail.fgac.ai` instead of `googleapis.com`.
3. **Authentication**: Use the `FGAC_PROXY_KEY` as the Authorization Bearer token.

### Code Examples for Workspace Scripts

If you write a Python script to interact with Gmail, structure it like this:

```python
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
import os

PROXY_KEY = os.environ.get("FGAC_PROXY_KEY")

# Create a credential object with the proxy key
creds = Credentials(token=PROXY_KEY)

# Point the service at gmail.fgac.ai.
# api_endpoint replaces rootUrl + servicePath, so include "/gmail/v1".
service = build(
    "gmail",
    "v1",
    credentials=creds,
    client_options={"api_endpoint": "https://gmail.fgac.ai/gmail/v1"}
)
```

### Multiple Email Accounts
A single `FGAC_PROXY_KEY` can access multiple inboxes if the key owner has delegated access. 
- When querying the owner's email, use `"me"`.
- When querying a delegated email, replace `"me"` in the API path with the specific email address (e.g., `service.users().messages().list(userId="colleague@domain.com", ...)`). You do NOT need a different API key.
