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
claude mcp add --transport http fgac-gmail https://fgac.ai/api/mcp
```

### Verify Install
```bash
claude mcp list
```
- [ ] `fgac-gmail` listed with URL `https://fgac.ai/api/mcp`

## Auth

1. Start Claude Code in tmux
2. `/mcp` → select `fgac-gmail` → Authenticate
3. Complete OAuth flow via browser → consent → approve in production dashboard

## Run ALL Capabilities

Follow `agents/02_claude_code_mcp.md` — MCP already points to production, no override needed.

- [ ] Send whitelist: allowed send, blocked send
- [ ] Read blacklist: blocked content, normal read
- [ ] Multi-email scoping: list_accounts shows correct emails
- [ ] Connection lifecycle: auth → approve → tools work
- [ ] get_my_permissions: correct data
