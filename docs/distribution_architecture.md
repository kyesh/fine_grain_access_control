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
| 5 | **Partner Handoff** | Pre-registered OAuth app → FGAC consent interstitial (consent-time provisioning, no pending step) | Nothing — `/oauth/authorize` + `/api/auth/partner-token`; optional signed webhooks | Third-party web apps with server-side agents |

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
    → Scripts mirror the standard Gmail API but route through gmail.fgac.ai
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

## Hosted MCP Tool Surface

Tool metadata (names, titles, descriptions, `readOnlyHint`/`destructiveHint`
annotations) lives in `src/app/api/mcp/toolDefs.ts` and is linted by
`npm run mcp:lint` (also run at the start of every build) against the Anthropic
Connectors Directory requirements: every tool titled and annotated, names ≤ 64
chars, no tool forwarding both safe and unsafe HTTP methods.

- **Read-only tools** (`readOnlyHint: true` — MCP clients may auto-run these):
  `list_accounts`, `gmail_list`, `gmail_read`, `gmail_get_attachment`,
  `gmail_labels`, `sheets_get_spreadsheet`, `sheets_read_range`,
  `get_my_permissions`, `google_api_get`
- **Write tools** (`destructiveHint` set — MCP clients prompt before running):
  `gmail_send`, `sheets_update_range`, `sheets_append_rows`, `google_api_modify`

**Raw Google API pair.** The former `raw_google_api_call` (one tool spanning
GET→DELETE — an automatic directory rejection) is split into `google_api_get`
(GET only) and `google_api_modify` (POST/PUT/PATCH). Both classify the request
deny-by-default in `src/app/api/mcp/googleApiPolicy.ts`:

- Gmail GETs are forwarded, then the **full response** passes the same
  label/content read-restriction checks as `gmail_read` (labels are collected
  recursively, so thread/list responses are covered).
- The only Gmail write is `messages/send`, with recipients parsed out of the
  RFC 2822 payload and checked against the send whitelist (unparseable → deny).
- Sheets calls require a per-spreadsheet rule; writes require Read & Write.
- Batch endpoints, spreadsheet creation, all other Gmail writes, and every
  other Google API are denied. DELETE is not exposed at all.

## API Surfaces

| Surface | URL | Auth | Used By |
|---------|-----|------|---------|
| REST Proxy | `https://gmail.fgac.ai/gmail/v1/...` | `Bearer sk_proxy_...` | Local scripts, direct API calls |
| MCP Server | `https://fgac.ai/api/mcp` | OAuth Bearer token (Clerk) | Claude Code MCP, any MCP client |
| CLI Token | `https://fgac.ai/api/auth/cli-token` | OAuth Bearer token (Clerk) | Local scripts (auth.js) — exchanges token for proxy key |
| Dashboard | `https://fgac.ai/dashboard` | Clerk session | Users managing agents |

## File Locations

| Component | Path |
|-----------|------|
| Hosted MCP Server | `src/app/api/mcp/route.ts` |
| CLI Token Endpoint | `src/app/api/auth/cli-token/route.ts` |
| OpenClaw SKILL.md | `docs/skills/fgac/SKILL.md` |
| OpenClaw scripts | `docs/skills/fgac/scripts/` *(symlink → public/skills/claude-code-cli/scripts/)* |
| Claude Code MCP SKILL.md | `public/skills/claude-code/SKILL.md` |
| Claude Code CLI plugin | `public/skills/claude-code-cli/` |
| Claude Code CLI SKILL.md | `public/skills/claude-code-cli/skills/fgac/SKILL.md` |
| Claude Code CLI scripts | `public/skills/claude-code-cli/scripts/` *(canonical location)* |
| Marketplace manifest | `.claude-plugin/marketplace.json` |
| Plugin manifest | `public/skills/claude-code-cli/.claude-plugin/plugin.json` |
| Discovery endpoints | `src/app/.well-known/oauth-*/route.ts` |
| Dashboard connections | `src/app/dashboard/ConnectionsPanel.tsx` |
| Connections API | `src/app/api/connections/route.ts` |


## Partner Handoff (Package #5)

Third-party apps registered in the `partner_apps` table (via
`scripts/register-partner-app.ts`, per Clerk instance) hand signed-in users to
FGAC's consent interstitial:

```
Partner site → fgac.ai/oauth/authorize?client_id=…
  → [Clerk session check → sign-in if needed]
  → FGAC consent (manifest-rendered permissions + mailbox picker)
  → Approve = provisioning transaction (key + email access + rule copies +
    approved connection pinned to manifestVersion [+ notification subscription])
  → 303 into Clerk /oauth/authorize (consent_screen_enabled=false → silent code)
  → partner callback → token exchange → optional /api/auth/partner-token → sk_proxy_
```

Bypassing the interstitial (driving Clerk's authorize directly) yields tokens
whose connection is pending-by-default — tools refuse until dashboard approval.

**Push notifications** (optional, manifest `notifications`): Gmail `users.watch`
→ Pub/Sub (`GMAIL_PUBSUB_TOPIC`, same GCP project as the Google OAuth client —
dev `dev-fgac-ai`, prod `fine-grain-access-control`) → `/api/webhooks/gmail`
(OIDC-verified) → read-rule filter → `webhook_deliveries` outbox → HMAC-signed
thin ping (message IDs only) → partner webhook. Crons: delivery drainer
(per-minute) + watch renewal (daily) in `vercel.json`. Infra:
`scripts/setup-gmail-push.ts`. Design + spike evidence:
`docs/implementation_plans/third-party-handoff-permissions_v6.md`.
