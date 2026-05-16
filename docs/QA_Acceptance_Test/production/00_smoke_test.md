# Production: Smoke Test

> Run first before any per-agent production tests.

## Prerequisites
- Production deployment live at `https://fgac.ai`
- Test email accounts active in production dashboard

## Tests

### 1. Discovery Endpoints

```bash
curl -sf https://fgac.ai/.well-known/oauth-authorization-server | jq .
curl -sf https://fgac.ai/.well-known/oauth-protected-resource/mcp | jq .
```
- [ ] Both return valid JSON
- [ ] Authorization server has `authorization_endpoint`, `token_endpoint`, `registration_endpoint`
- [ ] Protected resource has `resource` and `authorization_servers`

### 2. Unauthenticated MCP → 401

```bash
HTTP_CODE=$(curl -so /dev/null -w '%{http_code}' \
  -X POST https://fgac.ai/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}')
echo $HTTP_CODE
```
- [ ] Returns 401

### 3. Landing Page Loads

```bash
curl -sf https://fgac.ai -o /dev/null -w '%{http_code}'
```
- [ ] Returns 200
- [ ] Verify via browser agent: page renders correctly with light mode

### 4. Dashboard Accessible

- Via `/browser-agent`, navigate to `https://fgac.ai/dashboard`
- [ ] Redirects to sign-in if not authenticated
- [ ] After Google SSO, shows dashboard with keys and rules

### 5. REST Proxy Endpoint

```bash
curl -sf https://gmail.fgac.ai/ -o /dev/null -w '%{http_code}'
```
- [ ] Returns a response (not DNS error or timeout)
