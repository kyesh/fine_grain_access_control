---
name: Configure fgac.ai Gmail Proxy
description: Instructs Claude Cowork on how to use the fgac.ai proxy for Gmail access.
---

# fgac.ai Proxy Configuration for Claude Cowork

This skill teaches Claude Cowork how to access a user's Gmail inbox using the fine-grain access control (fgac.ai) proxy instead of directly querying the Google API.

## Core Instructions

1. **Override Endpoint**: When interacting with Gmail, DO NOT use `googleapis.com`. You MUST route all Gmail API requests to the proxy base URL: `https://fgac.ai/api/proxy`.
2. **Authentication**: Use the user-provided Proxy Key (`sk_proxy_...`) as the Bearer token in the `Authorization` header. Do NOT attempt to use real Google OAuth credentials.
   * `Authorization: Bearer <PROXY_KEY>`
3. **Targeting Inboxes**: 
   * To query the primary inbox associated with the key, use the `"me"` identifier: `https://fgac.ai/api/proxy/gmail/v1/users/me/messages`
   * To query a **delegated** or secondary inbox, replace `"me"` with the specific email address the user wants to access. 
   * *Example*: `https://fgac.ai/api/proxy/gmail/v1/users/boss@company.com/messages`
   * You DO NOT need separate API keys for different email accounts if they are granted to the same proxy key.

## Workflow Execution

1. Ask the user for their `fgac.ai` Proxy Key if you do not already have it stored in your context/secrets.
2. Ask the user which email address they primarily want you to read/manage. If they say "mine", use `"me"`. If they provide a specific address (e.g., `team@company.com`), use that explicitly in the URL path.
3. Formulate your HTTP requests using the proxy URL format.
4. Execute the requests.

> Note: If you receive a `403` error regarding "Email content blocked by rule", inform the user that their fgac.ai rules prevented you from reading that specific email. If you receive a `403` regarding "Unauthorized email address", inform them their rules prevent you from sending to that recipient.
