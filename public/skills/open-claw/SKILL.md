---
name: fgac.ai Configuration
description: Configures Open Claw to route Gmail requests through the fgac.ai security proxy.
---

# Open Claw: fgac.ai Integration

This skill defines how Open Claw should interact with Gmail securely using the `fgac.ai` proxy.

## System Prompt Addition

Open Claw, when executing tasks that require Gmail API access (like checking emails, sending emails, or managing labels), you MUST use the `fgac.ai` proxy.

### Requirements

1. **Base URL**: Change all target URLs from `https://gmail.googleapis.com/...` to `https://fgac.ai/api/proxy/gmail/...`
2. **Authentication**: Ask the user for their `fgac.ai` Proxy Key or retrieve it from your configured credentials store. Pass it in the header:
   `Authorization: Bearer sk_proxy_...`
3. **Handling Multiple Accounts**:
   * A single proxy key can manage multiple email accounts.
   * If the user asks you to check "my email", query the `me` endpoint: `https://fgac.ai/api/proxy/gmail/v1/users/me/messages`.
   * If the user asks you to check a *different* email (e.g., "check the support@ email"), query that specific address: `https://fgac.ai/api/proxy/gmail/v1/users/support@.../messages`. Do not ask for a new key; try the existing one first.
4. **Error Handling**: The proxy enforces read/send rules. If you receive a `403 Forbidden` response, do not attempt to bypass it or ask the user to re-authenticate with Google. Inform the user that their fgac.ai rules prevented the action.
