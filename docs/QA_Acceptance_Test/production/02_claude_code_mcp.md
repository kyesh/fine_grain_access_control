# Production: Claude Code MCP (Plugin Marketplace)

> Install: Via Claude Code plugin marketplace or `claude mcp add`
> Runs ALL capabilities against `https://fgac.ai/api/mcp`

## Install from Distribution Channel

### Option A: Plugin Marketplace
```
/plugin marketplace browse
```
Search for "fgac" → Install

### Option B: Manual MCP Add
```bash
claude mcp add --transport http fgac https://fgac.ai/api/mcp
```

### Verify Install
```bash
claude mcp list
```
- [ ] `fgac` listed with URL `https://fgac.ai/api/mcp`

## Auth

1. Start Claude Code in tmux
2. `/mcp` → select `fgac` → Authenticate
3. Complete OAuth flow via browser → consent → approve in production dashboard

## Run ALL Capabilities

> **CRITICAL**: Production testing MUST validate full end-to-end plumbing. Do not just verify installation.

Run the *exact same capability checklists* as the local tests, but against the production endpoints. Follow the steps in `agents/02_claude_code_mcp.md` (no URL override needed, MCP already points to production):

- `[ ]` Execute **Send Whitelist** checklist (→ `capabilities/01_send_whitelist.md`)
- `[ ]` Execute **Read Blacklist** checklist (→ `capabilities/02_read_blacklist.md`)
- `[ ]` Execute **Multi-Email Scoping** checklist (→ `capabilities/03_multi_email_scoping.md`)
- `[ ]` Execute **Delegation** checklist (→ `capabilities/04_delegation.md`)
- `[ ]` Execute **Connection Lifecycle** checklist (→ `capabilities/06_connection_lifecycle.md`)
- `[ ]` Execute **Key Lifecycle** checklist (→ `capabilities/07_key_lifecycle.md`)
- `[ ]` Execute **Label Access** checklist (→ `capabilities/05_label_access.md`)
