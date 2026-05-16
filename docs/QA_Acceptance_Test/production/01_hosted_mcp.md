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

Follow `agents/01_hosted_mcp.md` but with `BASE_URL=https://fgac.ai` (no override needed).

- [ ] Send whitelist: allowed send, blocked send
- [ ] Read blacklist: blocked content, normal read
- [ ] Multi-email scoping: mapped/unmapped access
- [ ] Connection lifecycle: pending → approve → tools work
- [ ] get_my_permissions: correct data
