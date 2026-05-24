---
name: gmail-fgac
description: Gmail integration secured by FGAC.AI — Fine Grain Access Control for AI agents.
homepage: https://fgac.ai
signature: "sha256:pending"
when_to_use: |
  User wants to read, send, or manage Gmail through a security proxy
  that enforces per-agent permission boundaries and prevents unauthorized
  data exfiltration.
license: MIT-0
metadata:
  author: fgac-ai
  version: "2.0.0"
  openclaw:
    emoji: "🛡️"
    requires:
      bins: [node]
      network: true
---

# Gmail with FGAC.AI Protection

Secure Gmail integration that routes all API requests through the [FGAC.AI](https://fgac.ai) security proxy.
Supports reading, listing, sending, and forwarding emails — with allow-list enforcement
that prevents unauthorized data exfiltration.

## What is FGAC.AI?

[FGAC.AI](https://fgac.ai) provides **Fine Grain Access Control** for AI agents accessing
Google APIs. It acts as a transparent proxy that enforces:

- **Content Filtering**: Block agents from reading sensitive emails (2FA, password resets)
- **Recipient Allow-lists**: Restrict who agents can send/forward emails to
- **Deletion Safeguards**: Whitelist domains for deletion, block "Empty Trash"
- **Agent Profiles**: Each agent gets its own proxy key with scoped permissions

Uses standard Google SDKs with a root URL override pointing to `https://gmail.fgac.ai`.

## Getting Started

1. **Create an account** at https://fgac.ai/sign-up
   - Sign up with the Google account you want to protect
2. **Generate a Proxy Key** from the FGAC.AI dashboard
   - Create a key labeled for this agent (e.g., "OpenClaw Agent")
   - Map it to the email accounts it should access
3. **Install this skill** into your OpenClaw instance
   - Copy the `gmail-fgac` folder to `~/.openclaw/skills/gmail-fgac/`
4. **Place credentials** in the tokens directory:
   ```
   ~/.openclaw/gmail-fgac/tokens/<account-label>.json
   ```
   Token file format:
   ```json
   {
     "proxyKey": "sk_proxy_...",
     "proxyEndpoint": "https://gmail.fgac.ai"
   }
   ```

## Actions

- `list` — List recent emails (supports Gmail search queries)
- `read` — Read a specific email by Message ID
- `send` — Compose and send a new email
- `forward` — Forward an existing email to a recipient
- `labels` — List all Gmail labels
- `attachment` — Download email attachments

## Usage

```bash
# List recent emails
node scripts/gmail.js --account <label> --action list [--query "is:unread"] [--max 10]

# Read a specific email
node scripts/gmail.js --account <label> --action read --message-id <id>

# Send a new email
node scripts/gmail.js --account <label> --action send --to <email> --subject "Subject" --body "Body text"

# Forward an email
node scripts/gmail.js --account <label> --action forward --message-id <id> --to <email>

# List labels
node scripts/gmail.js --account <label> --action labels

# Download attachment
node scripts/gmail.js --account <label> --action attachment --message-id <id> [--out-dir /tmp]

# List available accounts
node scripts/accounts.js --action list
```

## How Authentication Works

This skill uses the explicit endpoint override pattern (NOT `universe_domain`):

```javascript
// FGAC.AI service account: Bearer token + rootUrl override
const auth = new google.auth.OAuth2();
auth.setCredentials({ access_token: proxyKey }); // sk_proxy_xxx

// rootUrl replaces only the domain — the SDK appends /gmail/v1/ automatically.
const gmail = google.gmail({
  version: 'v1',
  auth,
  rootUrl: 'https://gmail.fgac.ai/',  // Routes to FGAC.AI proxy
});
```

> **Why not `universe_domain`?** Google Workspace APIs (Gmail, Calendar, Drive) do not support
> automatic endpoint resolution via `universe_domain`. The `googleapis` npm package hardcodes
> API endpoints to `*.googleapis.com`. See the [ADR](https://fgac.ai) for full details.

## Security Architecture

When configured with FGAC.AI credentials, all Gmail API requests are routed through the
FGAC.AI proxy. Each proxy key has:

- **Email scoping** — only accesses emails mapped to this key
- **Access rules** — read blacklists, send whitelists, label controls
- **Global safeguards** — permanent deletion always blocked

If the agent attempts an action that violates your security policies
(e.g., sending to an unapproved recipient), the proxy returns a 403 Forbidden error
with a clear message explaining why the action was blocked.

## Learn More

- Website: https://fgac.ai
- Dashboard: https://fgac.ai/dashboard
- Privacy Policy: https://fgac.ai/privacy
- Terms of Service: https://fgac.ai/terms
