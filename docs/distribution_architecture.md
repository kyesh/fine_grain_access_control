# FGAC.ai Distribution Architecture

> **Canonical reference** for how FGAC.ai is packaged and distributed to agents.
> This document defines the 4 distribution packages, their auth mechanisms,
> and what code ships for each. All implementation plans should reference this.

## Distribution Packages

We ship **4 distinct packages**, each designed for a different client and use case:

| # | Package | Auth Mechanism | What Ships | Target Client |
|---|---------|---------------|------------|---------------|
| 1 | **Hosted MCP Server** | OAuth (Clerk DCR → Pending Approval) | Nothing — hosted at `/api/mcp` | Any MCP-compatible agent |
| 2 | **OpenClaw Skill** | OAuth baked into local scripts | `SKILL.md` + local scripts (`auth.js`, `gmail.js`, etc.) | OpenClaw |
| 3 | **Claude Code MCP Plugin** | OAuth (via hosted MCP server) | `claude mcp add` command | Claude Code (MCP users) |
| 4 | **Claude Code CLI Plugin** | OAuth baked into local scripts (shared w/ #2) | `SKILL.md` + local scripts | Claude Code (CLI users) |

## Key Design Principles

### Packages #2 and #4 share scripts
The OpenClaw skill and Claude Code CLI plugin use the **same underlying scripts**. The OAuth flow is implemented in the shipped code (`auth.js`), giving agents the ability to read, modify, and extend the Gmail integration. This is in contrast to #1 and #3, which delegate auth to the hosted MCP server.

### Hosted MCP vs Local Scripts — when to use which
- **Hosted MCP** (#1, #3): Best for native MCP clients. Agent gets structured tools. Least code to ship. But it's an opaque remote server — limits agent's ability to innovate.
- **Local Scripts** (#2, #4): Best for code-first agents. Agent can read, modify, and extend scripts. Full Gmail API surface via REST proxy. Better ClawHub trust score (all code visible to scanners).

### Auth flow comparison

```
Hosted MCP (#1, #3):
  Agent → /api/mcp → Clerk OAuth (DCR + consent)
    → Pending Approval → User approves in dashboard → Proxy Key assigned
    → Agent tools execute with that key's permissions

Local Scripts (#2, #4):
  Agent → runs auth.js → FGAC OAuth (browser opens for consent)
    → Token saved locally → scripts use token + REST proxy
    → Proxy key resolved server-side from OAuth identity
```

## Permission Chain

All packages ultimately resolve to the same permission chain:

```
Identity (OAuth token or API key)
  → userId
  → proxy_key
  → key_email_access (which emails this key can reach)
  → access_rules (send whitelist, read blacklist, deletion controls)
  → Clerk Google OAuth token (for the email owner)
  → Gmail API
```

## Multi-Email Support

Each proxy key can access multiple email accounts via `key_email_access`:
- **Own email:** Always accessible if mapped to the key
- **Delegated emails:** Resolved via `email_delegations` table; Google token fetched from the email owner's Clerk account
- **Account parameter:** All tools accept an optional `account` param. `"me"` = key owner's primary email

## API Surfaces

| Surface | URL | Auth | Used By |
|---------|-----|------|---------|
| REST Proxy | `https://gmail.fgac.ai/gmail/v1/...` | `Bearer sk_proxy_...` | Local scripts, direct API calls |
| MCP Server | `https://fgac.ai/api/mcp` | OAuth Bearer token (Clerk) | Claude Code MCP, any MCP client |
| Dashboard | `https://fgac.ai/dashboard` | Clerk session | Users managing agents |

## File Locations

| Component | Path |
|-----------|------|
| Hosted MCP Server | `src/app/api/mcp/route.ts` |
| OpenClaw SKILL.md | `docs/skills/gmail-fgac/SKILL.md` |
| OpenClaw scripts | `docs/skills/gmail-fgac/scripts/` |
| Claude Code MCP SKILL.md | `public/skills/claude-code/SKILL.md` |
| Claude Code CLI scripts | *(shares OpenClaw scripts — see SKILL.md Option B)* |
| Discovery endpoints | `src/app/.well-known/oauth-*/route.ts` |
| Dashboard connections | `src/app/dashboard/ConnectionsPanel.tsx` |
| Connections API | `src/app/api/connections/route.ts` |
