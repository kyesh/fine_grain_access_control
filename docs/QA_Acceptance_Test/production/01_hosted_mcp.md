# Production: Hosted MCP

> Install: Direct curl against `https://fgac.ai/api/mcp`
> Runs ALL capabilities against production.

## Install

No install needed — direct HTTP access to the hosted MCP endpoint.

```bash
BASE_URL=https://fgac.ai
```

## Auth

1. Register DCR client against production:
   ```bash
   REG_ENDPOINT=$(curl -sf $BASE_URL/.well-known/oauth-authorization-server | jq -r '.registration_endpoint')
   DCR=$(curl -sf $REG_ENDPOINT -X POST -H "Content-Type: application/json" \
     -d '{"client_name":"QA Prod Hosted MCP","redirect_uris":["http://localhost:9999/callback"],"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none"}')
   ```
2. Complete OAuth via browser agent
3. Approve connection in production dashboard

## Run ALL Capabilities

> **CRITICAL**: Production testing MUST validate full end-to-end plumbing. Do not just verify installation.

Run the *exact same capability checklists* as the local tests, but against the production `fgac.ai` endpoints. Follow the steps in `agents/01_hosted_mcp.md` using `BASE_URL=https://fgac.ai`:

- `[ ]` Execute **Send Whitelist** checklist (→ `capabilities/01_send_whitelist.md`)
- `[ ]` Execute **Read Blacklist** checklist (→ `capabilities/02_read_blacklist.md`)
- `[ ]` Execute **Multi-Email Scoping** checklist (→ `capabilities/03_multi_email_scoping.md`)
- `[ ]` Execute **Delegation** checklist (→ `capabilities/04_delegation.md`)
- `[ ]` Execute **Connection Lifecycle** checklist (→ `capabilities/06_connection_lifecycle.md`)
- `[ ]` Execute **Key Lifecycle** checklist (→ `capabilities/07_key_lifecycle.md`)
- `[ ]` Execute **Label Access** checklist (→ `capabilities/05_label_access.md`)
