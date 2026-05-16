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

### Option B: CLI Mode (Local Scripts)

For users who prefer CLI over MCP, or want to modify/extend the scripts:

1. **Clone the scripts** to your workspace:
   ```bash
   cp -r /path/to/fgac/docs/skills/gmail-fgac/scripts ./fgac-scripts
   cd fgac-scripts && npm install
   ```

2. **Authenticate** (one-time, opens browser):
   ```bash
   node auth.js --action login
   ```
   - Browser opens for FGAC sign-in
   - After consent: "⚠️ Pending approval" → visit dashboard to approve
   - After approval: `node auth.js --action status` retrieves your proxy key

3. **Use Gmail** through the scripts:
   ```bash
   node gmail.js --action list                    # List recent emails
   node gmail.js --action read --message-id <id>  # Read specific email
   node gmail.js --action send --to user@example.com --subject "Hi" --body "Hello"
   ```

The scripts mirror the standard Gmail API but route through `gmail.fgac.ai`. You can read, modify, and extend them.

## Instructions for Claude Code

When the user asks you to interact with Gmail:

1. **If using MCP (Option A):** Use the `fgac-gmail` MCP tools directly.
2. **If using CLI (Option B):** Run the scripts above. They handle auth and routing.
3. **All requests route through `gmail.fgac.ai`** — never use `googleapis.com` directly.
4. **Authentication is handled automatically** — scripts use the saved proxy key.

### Code Examples for Custom Scripts

If you write a custom Python script, use the proxy key:

```python
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
import os

PROXY_KEY = os.environ.get("FGAC_PROXY_KEY")

# Point the service at gmail.fgac.ai.
# api_endpoint replaces rootUrl + servicePath, so include "/gmail/v1".
service = build(
    "gmail",
    "v1",
    credentials=Credentials(token=PROXY_KEY),
    client_options={"api_endpoint": "https://gmail.fgac.ai/gmail/v1"}
)
```

### Multiple Email Accounts
A single proxy key can access multiple inboxes if the key owner has delegated access. 
- When querying the owner's email, use `"me"`.
- When querying a delegated email, replace `"me"` with the specific email address (e.g., `service.users().messages().list(userId="colleague@domain.com", ...)`).

