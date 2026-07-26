---
name: fgac
description: >
  Gmail integration secured by FGAC.AI — Fine Grain Access Control for AI agents.
  Use when the user wants to read, send, or manage Gmail through a security proxy
  that enforces per-agent permission boundaries.
allowed-tools: Bash(node:*)
---

# Gmail with FGAC.AI Protection

Secure Gmail integration that routes all API requests through the [FGAC.AI](https://fgac.ai) security proxy.
Supports reading, listing, sending, and forwarding emails — with allow-list enforcement
that prevents unauthorized data exfiltration.

## First-Time Setup

If this is the first time using this skill, authenticate with FGAC.AI:

```bash
node scripts/auth.js --action login
```

This will:
1. Open a browser for FGAC.AI sign-in (Google OAuth)
2. After consent, check connection status
3. If "pending approval" — the user must visit their [dashboard](https://fgac.ai/dashboard?tab=connections) to approve this agent
4. After approval, run `node scripts/auth.js --action status` to retrieve the proxy key

The proxy key is saved locally and used automatically by all scripts.

> **Local development**: Set `FGAC_ROOT_URL=http://localhost:3000` to test against a local server.

## Available Actions

### List Emails
```bash
node scripts/gmail.js --action list [--query "is:unread"] [--max 10]
```

### Read a Specific Email
```bash
node scripts/gmail.js --action read --message-id <id>
```

### Send an Email
```bash
node scripts/gmail.js --action send --to <email> --subject "Subject" --body "Body text"
```

### Forward an Email
```bash
node scripts/gmail.js --action forward --message-id <id> --to <email>
```

### List Labels
```bash
node scripts/gmail.js --action labels
```

### Download Attachments
```bash
node scripts/gmail.js --action attachment --message-id <id> [--out-dir /tmp]
```

### List Available Email Accounts
```bash
node scripts/accounts.js --action list
```

## How It Works

All requests route through `gmail.fgac.ai` — **never** use `googleapis.com` directly.
The proxy enforces the user's access control rules:

- **Send whitelist**: Only approved recipients
- **Read blacklist**: Block sensitive emails (2FA, password resets)
- **Deletion safeguards**: Controlled per-domain
- **Agent profiles**: Each agent gets scoped permissions via its proxy key

If the proxy returns a **403 Forbidden**, inform the user that their FGAC.AI rules
prevented the action. Do not attempt to bypass it.

## Multiple Email Accounts

A single proxy key can access multiple inboxes if the key owner has delegated access.
Use `node scripts/accounts.js --action list` to see which accounts are available.

The `--account` flag is not needed when using FGAC OAuth mode (the default).
The scripts automatically use the proxy key from `~/.openclaw/fgac/fgac-credentials.json`.

## Auth Management

```bash
node scripts/auth.js --action login     # Full OAuth flow (one-time)
node scripts/auth.js --action status    # Check connection + retrieve proxy key
node scripts/auth.js --action refresh   # Refresh expired access token
```
