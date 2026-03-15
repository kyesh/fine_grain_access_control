---
name: fgac.ai Gmail Proxy
description: Replaces direct Google API calls with the secure fgac.ai proxy for Claude Code workspace operations.
---

# Claude Code: fgac.ai configuration

This skill ensures Claude Code operates securely via the fgac.ai proxy when managing Gmail tasks within the workspace.

## Setup Instructions for the User

1. Obtain a Proxy Key (`sk_proxy_...`) from `https://fgac.ai/dashboard`.
2. Ensure this proxy key is available in your environment, typically as `FGAC_PROXY_KEY`.

## Instructions for Claude Code

When the user asks you to interact with Gmail (e.g., via a Python script or direct API calls within the workspace), you must adhere to the following constraints:

1. **Never use standard Google `credentials.json` or OAuth flows for Gmail.**
2. **Override the API Endpoint**: All requests must be sent to `https://fgac.ai/api/proxy` instead of `googleapis.com`.
3. **Authentication**: Use the `FGAC_PROXY_KEY` as the Authorization Bearer token.

### Code Examples for Workspace Scripts

If you write a Python script to interact with Gmail, structure it like this:

```python
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
import os

PROXY_KEY = os.environ.get("FGAC_PROXY_KEY")
PROXY_URL = "https://fgac.ai/api/proxy"

# Create a credential object with the proxy key
creds = Credentials(token=PROXY_KEY)

# Point the service at fgac.ai
service = build(
    "gmail",
    "v1",
    credentials=creds,
    client_options={"api_endpoint": PROXY_URL}
)
```

### Multiple Email Accounts
A single `FGAC_PROXY_KEY` can access multiple inboxes if the key owner has delegated access. 
- When querying the owner's email, use `"me"`.
- When querying a delegated email, replace `"me"` in the API path with the specific email address (e.g., `service.users().messages().list(userId="colleague@domain.com", ...)`). You do NOT need to request a different API key.
