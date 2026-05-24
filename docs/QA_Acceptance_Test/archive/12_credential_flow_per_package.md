# QA Test 12 — Credential Flow Per Package

## Objective
Validate that each distribution package's install → authenticate → first-tool-call flow works end-to-end.

> [!IMPORTANT]
> This is the only package-oriented test file. Authentication is inherently package-specific — each package has a different auth mechanism. All other features (whitelists, delegation, multi-email) are tested across packages within their own feature test files (QA 02, 03, 04).

## Prerequisites
- [ ] Dev server running (`npm run dev`) or Vercel preview deployed
- [ ] Chrome with remote debugging for dashboard steps
- [ ] At least one proxy key with email mapped
- [ ] Claude Code CLI installed (`claude` command) for Section 2

---

## Section 1: Hosted MCP Server (OAuth via DCR)

**Validates:** Package #1 — any MCP agent connecting via raw OAuth.

### Steps:

1. **Discover endpoints:**
   ```bash
   AUTH_META=$(curl -s $BASE_URL/.well-known/oauth-authorization-server)
   REG_ENDPOINT=$(echo $AUTH_META | python3 -c "import sys,json; print(json.load(sys.stdin)['registration_endpoint'])")
   ```

2. **Register DCR client:**
   ```bash
   curl -s -X POST "$REG_ENDPOINT" \
     -H "Content-Type: application/json" \
     -d '{"client_name": "QA-Test-MCP-Agent", "redirect_uris": ["http://localhost:8976/callback"]}'
   ```
   - [ ] Returns `client_id`

3. **Build authorization URL** with `client_id`, `redirect_uri`, PKCE `code_verifier`

4. **User completes consent in browser** (Clerk consent page)

5. **Exchange code for token** at `token_endpoint`
   - [ ] Returns `access_token` and `refresh_token`

6. **Call `list_accounts`:**
   ```bash
   curl -s $BASE_URL/api/mcp \
     -X POST -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -H "Authorization: Bearer $ACCESS_TOKEN" \
     -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_accounts","arguments":{}},"id":1}'
   ```
   - [ ] Returns "⚠️ Pending approval" with dashboard link

7. **Approve in dashboard** (via `/browser-agent`):
   - Navigate to dashboard connections
   - [ ] Pending connection visible with "QA-Test-MCP-Agent" client name
   - Assign proxy key, click Approve

8. **Retry `list_accounts`:**
   - [ ] Returns accessible email accounts
   - [ ] No pending message

---

## Section 2: Claude Code MCP Plugin

**Validates:** Package #3 — Claude Code native MCP integration.

### Steps:

1. **Install MCP server:**
   ```bash
   claude mcp add --transport http fgac-gmail $BASE_URL/api/mcp
   ```

2. **Verify installation:**
   ```bash
   claude mcp list
   ```
   - [ ] `fgac-gmail` appears with status

3. **First tool invocation** — in Claude Code:
   > "Use fgac-gmail to list my email accounts"
   - [ ] Claude Code opens browser for Clerk OAuth consent

4. **Complete consent** in browser

5. **Verify pending:**
   - [ ] Tool response contains "⚠️ This connection has not been approved yet"
   - [ ] Response includes dashboard URL

6. **Approve in dashboard** (via `/browser-agent`):
   - Navigate to connections tab
   - [ ] New pending connection visible with Claude Code's client name
   - Assign nickname + proxy key, click Approve

7. **Re-invoke:**
   > "List my email accounts using fgac-gmail"
   - [ ] Returns email list

8. **Test read:**
   > "Read my latest email"
   - [ ] Returns email content

9. **Cleanup:**
   ```bash
   claude mcp remove fgac-gmail
   ```
   - [ ] `fgac-gmail` removed from `claude mcp list`

---

## Section 3: Claude Code CLI Plugin (OAuth in Scripts)

> [!NOTE]
> **Scripts built and verified.** FGAC OAuth flow (DCR + PKCE) implemented in `auth.js`.

**Validates:** Package #4 — Claude Code users who prefer CLI/scripts over MCP.

### Steps:

1. **Install scripts** per SKILL.md Option B instructions

2. **Run OAuth flow:**
   ```bash
   node scripts/auth.js --action login
   ```
   - [ ] Browser opens for FGAC OAuth consent (NOT Google BYOK)
   - [ ] Consent page shows FGAC.ai branding

3. **Complete consent**
   - [ ] Token saved locally (refresh token persisted)

4. **List emails:**
   ```bash
   node scripts/gmail.js --action list
   ```
   - [ ] Returns email list via `gmail.fgac.ai` proxy

5. **Verify token persistence:**
   - Kill terminal, restart
   ```bash
   node scripts/gmail.js --action list
   ```
   - [ ] Works without re-consent (refresh token used)

6. **Verify scripts mirror Gmail API:**
   - [ ] `--action list` corresponds to `GET /gmail/v1/users/me/messages`
   - [ ] `--action read --message-id <id>` corresponds to `GET /gmail/v1/users/me/messages/<id>`
   - [ ] `--action send` corresponds to `POST /gmail/v1/users/me/messages/send`

---

## Section 4: OpenClaw Skill (OAuth in Scripts)

> [!NOTE]
> **Scripts built and verified.** Same scripts as Section 3, installed to `~/.openclaw/skills/gmail-fgac/`.

**Validates:** Package #2 — OpenClaw with full script control.

### Steps:

1. **Install skill:**
   ```bash
   cp -r docs/skills/gmail-fgac ~/.openclaw/skills/gmail-fgac
   ```

2. **Run OAuth flow:**
   ```bash
   node ~/.openclaw/skills/gmail-fgac/scripts/auth.js --action login
   ```
   - [ ] Browser opens for FGAC OAuth consent
   - [ ] Token saved to `~/.openclaw/gmail-fgac/tokens/`

3. **List emails via script:**
   ```bash
   node ~/.openclaw/skills/gmail-fgac/scripts/gmail.js --action list
   ```
   - [ ] Returns email list via proxy

4. **List emails via OpenClaw agent:**
   > "List my recent emails"
   - [ ] Agent invokes skill script
   - [ ] Returns email data through FGAC proxy

5. **Multi-account via script:**
   ```bash
   node scripts/accounts.js --action list
   ```
   - [ ] Shows accessible accounts for this key

---

## Section 5: OAuth Token Refresh

**Validates:** Transparent token renewal across packages.

### Steps:

1. After Section 1 or 2 completes, wait for access token to approach expiration (24h for Clerk tokens) or simulate with a shortened token

2. Make another tool call

3. **Verify:**
   - [ ] Client uses refresh token to get new access token transparently
   - [ ] No re-consent required
   - [ ] Tool call succeeds

4. **For scripts (Section 3/4):**
   - Manually expire the stored access token
   - Run `node scripts/gmail.js --action list`
   - [ ] Script detects expired token, uses refresh token, saves new access token
   - [ ] No browser interaction required
