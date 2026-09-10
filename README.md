# FGAC.ai

> Fine-grain access control for AI agents on Gmail, Google Sheets and Google Docs.

[![Website](https://img.shields.io/badge/fgac.ai-live-2ea44f)](https://fgac.ai)
[![Docs](https://img.shields.io/badge/docs-fgac.ai%2Fdocs-blue)](https://fgac.ai/docs)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-ai.fgac%2Ffgac-6f42c1)](https://registry.modelcontextprotocol.io/v0.1/servers?search=ai.fgac)
[![smithery badge](https://smithery.ai/badge/fgac/fgac)](https://smithery.ai/servers/fgac/fgac)

**Product:** https://fgac.ai · **Docs:** https://fgac.ai/docs · **Privacy:** https://fgac.ai/privacy

FGAC.ai is a hosted MCP server and API proxy that sits between your AI agents and
your Google accounts. Connect one or many Gmail accounts — work, school, personal,
and inboxes teammates delegate to you — plus the specific Google Sheets and Docs
you choose, and every request passes through deny-by-default access rules you
control before it touches Google. Nothing to install, no Google Cloud project
needed: sign in with Google and the agent can read that account's mail
immediately; sending, editing, and other inboxes are granted from your dashboard
or from a one-click approval link the agent hands you when it is denied.

## Add FGAC to your agent

| Client | How |
|---|---|
| Claude.ai / Claude Desktop | Search **FGAC** in the connectors directory, or add a custom connector with the URL below |
| Claude Code | `claude mcp add --transport http fgac https://fgac.ai/api/mcp` |
| VS Code / Copilot, Cursor, Windsurf, Cline | Add a remote MCP server: `https://fgac.ai/api/mcp` (Streamable HTTP, OAuth sign-in) — or find `ai.fgac/fgac` in the [MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=ai.fgac) |
| Smithery | [smithery.ai/servers/fgac/fgac](https://smithery.ai/servers/fgac/fgac) |
| Any Google SDK | Point the client's endpoint override at `https://fgac.ai/api/proxy` with an FGAC proxy key — see the [docs](https://fgac.ai/docs) |

MCP endpoint: **`https://fgac.ai/api/mcp`** (Streamable HTTP; OAuth 2.1 with
dynamic client registration and PKCE; discovery at
`/.well-known/oauth-protected-resource/mcp`).

## What you get

- **Multiple Gmail accounts** — connect several accounts, and let teammates
  delegate their inboxes to your agent from their own dashboard. Every
  delegation keeps its own rules and is revocable in one click. No password
  sharing.
- **Editable Google Sheets and Docs** — expose individual files read-only or
  read & write; agents can update cells, append rows, and edit documents there
  and nowhere else. The rest of your Drive does not exist to them.
- **Guardrails** — read rules hide sensitive mail (2FA codes, password resets,
  financial alerts) by label or content pattern; send whitelists limit outbound
  mail to recipients you approve; permanent deletion is never possible.
- **One-click approvals** — when an agent needs more (a new recipient, a new
  sheet), it asks; you approve exactly that grant from a single-use link.
- **Nineteen tools** — typed Gmail, Sheets, Docs, and comments tools with safety
  annotations, plus a rule-checked raw Google API escape hatch covering the full
  Gmail, Sheets, and Docs API surface.
- **A request log** — every call your agent makes, with what was allowed and
  what was blocked and why.

Your data is never stored or used for training. Free for personal use.

## Licensing

This project is explicitly licensed for **Personal Use Only**. It may only be
utilized by independent individuals managing their own personal Gmail or Google
Workspace accounts.

Any corporate use, use by employees on behalf of their company, or use within
educational institutions is strictly prohibited without a separate Enterprise or
Educational license. See `LICENSE` for exact liability limitations and
restrictions.

## Developing

This is a Next.js app deployed on Vercel, with Clerk for authentication and Neon
Postgres via Drizzle. There is exactly one supported way to run it locally, and
it depends on access to the project's Vercel environment:

```bash
npx vercel link --yes --project fine-grain-access-control   # once per clone
npx vercel env pull .env.local --environment=development     # dev Clerk + Neon creds
npm run db:branch                                            # isolated Neon branch
npm run dev
```

Node 20.9+ is required. `npm run env:check` diagnoses environment problems.
Contributor rules, QA workflow, and database safety guards are documented in
`CLAUDE.md` and `docs/`.
