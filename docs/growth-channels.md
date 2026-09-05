# Growth Channels — listing ledger and publishing runbook

Where FGAC's hosted MCP server (`https://fgac.ai/api/mcp`) is listed, what is
still pending, and the exact steps that need a human. Strategy and rationale
live in `docs/implementation_plans/connector-growth_v2.md` and
`docs/distribution_architecture.md`; this file is the operational ledger.

Listing copy source of truth: `docs/connector_submission/listing_copy.md`
(keyword-first — capabilities before the security story).

## Ledger

| surface | submitted | status | listing link |
|---|---|---|---|
| Claude connector directory | 2026-08-16 | **live** | https://claude.ai/directory (search "FGAC") |
| Official MCP Registry (registry.modelcontextprotocol.io) | — | pending — manifest `server.json` + domain proof route in repo; publish via the **MCP Registry Publish** GitHub Action | https://registry.modelcontextprotocol.io/v0.1/servers?search=ai.fgac |
| GitHub MCP Registry (github.com/mcp) | — | pending — auto-propagates from the official registry, no separate submission (VS Code / Copilot `/mcp search` consumes it) | https://github.com/mcp |
| Smithery | — | pending — submit URL at https://smithery.ai/new; `/.well-known/mcp/server-card.json` fallback is served in case the auto-scan stalls on DCR | https://smithery.ai/server/fgac (expected slug) |
| ChatGPT Plugin directory | — | pending (30–120 day review, no fee; see memory note "OpenAI Plugin Directory") | https://chatgpt.com/plugins |
| Cline MCP Marketplace | — | optional, not submitted — GitHub issue template below | https://github.com/cline/mcp-marketplace |
| PulseMCP | — | optional, not submitted — submit button on the site | https://www.pulsemcp.com/submit |
| Glama | — | optional — `/.well-known/glama.json` (maintainer: support@fgac.ai) is served; claim at https://glama.ai/mcp/servers | https://glama.ai/mcp/servers |
| awesome-mcp-servers (mcpservers.org) | — | optional, not submitted | https://mcpservers.org/submit |

Update the *submitted* and *status* columns as each step lands.

## What is in the repo (automated)

| piece | path | serves |
|---|---|---|
| Registry manifest | `server.json` (repo root) | `ai.fgac/google-workspace`, remote `streamable-http` at `https://fgac.ai/api/mcp`; version tracks `package.json` (enforced by `scripts/test-server-json.ts` in `npm run mcp:lint`) |
| Domain proof | `src/app/.well-known/mcp-registry-auth/route.ts` | `v=MCPv1; k=ed25519; p=<public key>` as text/plain at `https://fgac.ai/.well-known/mcp-registry-auth` |
| Smithery server card | `src/app/.well-known/mcp/server-card.json/route.ts` | JSON card built from `server.json` + `TOOL_DEFS` at `https://fgac.ai/.well-known/mcp/server-card.json` |
| Glama maintainer file | `public/.well-known/glama.json` | `https://fgac.ai/.well-known/glama.json` |
| 400×400 logo | `public/logo-400.png` | `https://fgac.ai/logo-400.png` (registry `icons`, Cline marketplace) |
| Publish workflow | `.github/workflows/mcp-registry-publish.yml` | `workflow_dispatch`: install `mcp-publisher`, check the live proof, `login http`, `publish`, verify search |

The private key exists **only** at `.secrets/mcp-registry-key.pem` on the machine
that generated it (gitignored) and, once step 2 below is done, in the GitHub
Actions secret. Losing both means re-keying: regenerate the pair, replace the
record string in the route, redeploy, re-add the secret.

## Human checklist (in order)

### 1. Back up the private key to 1Password

The key is on this machine only. Create a 1Password item (type: Document or
Secure Note) named **"FGAC MCP Registry signing key (Ed25519)"** and attach or
paste the contents of:

```bash
cat .secrets/mcp-registry-key.pem
```

Do not paste it anywhere that reaches GitHub, chat, or a ticket.

### 2. Add the GitHub Actions secret

Print the raw hex private key (64 hex chars) and store it as the repository
secret `MCP_PUBLISHER_PRIVATE_KEY`:

```bash
openssl pkey -in .secrets/mcp-registry-key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n'
```

Either paste it at
https://github.com/kyesh/fine_grain_access_control/settings/secrets/actions/new
or from the CLI (reads from stdin, nothing lands in shell history):

```bash
openssl pkey -in .secrets/mcp-registry-key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n' | gh secret set MCP_PUBLISHER_PRIVATE_KEY --repo kyesh/fine_grain_access_control
```

### 3. Merge the PR and deploy production

Merge the PR, then run `/deploy-prod` (user-only). The registry cannot verify
the domain until the well-known routes are live. Confirm:

```bash
curl -fsS https://fgac.ai/.well-known/mcp-registry-auth && curl -fsS https://fgac.ai/.well-known/mcp/server-card.json | jq '.serverInfo, (.tools | length)'
```

Expected: the `v=MCPv1; k=ed25519; p=…` line, then the serverInfo block and
the tool count (currently 19).

### 4. Publish to the official MCP Registry

**Option A — one click:** https://github.com/kyesh/fine_grain_access_control/actions/workflows/mcp-registry-publish.yml
→ *Run workflow* on `main`. The job checks the live proof, validates
`server.json`, logs in with the secret, publishes, and greps the search API.

**Option B — locally:**

```bash
brew install mcp-publisher
```

```bash
mcp-publisher login http --domain fgac.ai --private-key "$(openssl pkey -in .secrets/mcp-registry-key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
```

```bash
mcp-publisher publish server.json
```

Verify (either option):

```bash
curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=ai.fgac" | jq '.servers[] | {name: .server.name, version: .server.version, status: ._meta}'
```

The GitHub MCP Registry (github.com/mcp) ingests the official registry; allow
up to a day, then search "FGAC" there and record the link in the ledger.

**Republishing** (registry preview reset, or a new version): bump `version` in
`package.json` *and* `server.json` (the lint test keeps them equal), merge,
re-run the workflow. The registry refuses to overwrite an existing version.

### 5. Smithery

1. Sign in at https://smithery.ai/new (GitHub account).
2. Submit the server URL `https://fgac.ai/api/mcp` (Streamable HTTP, OAuth).
3. If the automatic scan stalls at the auth wall (Smithery registers clients
   via Client ID Metadata Documents; FGAC's Clerk authorization server uses
   Dynamic Client Registration), Smithery falls back to the card at
   `https://fgac.ai/.well-known/mcp/server-card.json`, which is already live
   after step 3. If the form asks, the scan may be completed by authenticating
   with a QA account — never a personal one.
4. Record the listing URL in the ledger.

### 6. Optional same-afternoon batch

**Cline MCP Marketplace** — open a new issue at
https://github.com/cline/mcp-marketplace/issues/new/choose ("Server Submission")
and attach `public/logo-400.png` (400×400 PNG, resampled from the 381×379
brand mark `public/logo-v2.png`). Body:

> **GitHub Repo URL:** https://github.com/kyesh/fine_grain_access_control
>
> **Logo:** attached, 400×400 PNG.
>
> **Server type:** remote (Streamable HTTP) — `https://fgac.ai/api/mcp`, OAuth
> 2.1 with Dynamic Client Registration and PKCE; no install step, no API key.
>
> **Reason for addition:** FGAC.ai gives AI agents access to multiple Gmail
> accounts (work, school, personal, and inboxes delegated by teammates) and to
> editable Google Sheets and Google Docs, behind deny-by-default access rules
> the user controls: read rules hide sensitive mail (2FA codes, password
> resets), send whitelists limit outbound mail, per-file rules expose only the
> spreadsheets and documents chosen. A denied action returns a one-click
> approval link instead of a dead end. Nineteen tools — typed Gmail, Sheets,
> Docs and comments tools plus a rule-checked raw Google API escape hatch.
>
> **Installation testing:** I have tested the server with Cline: add
> `https://fgac.ai/api/mcp` as a remote (Streamable HTTP) server, complete the
> browser sign-in, and the tool list appears with annotations. Documentation:
> https://fgac.ai/docs. Privacy policy: https://fgac.ai/privacy.

**PulseMCP** — https://www.pulsemcp.com/submit. Fields: name `FGAC.ai`; URL
`https://fgac.ai/api/mcp`; repo `https://github.com/kyesh/fine_grain_access_control`;
short description:

> Multiple Gmail accounts, editable Google Sheets & Docs for AI agents. Deny-by-default access rules.

**Glama** — https://glama.ai/mcp/servers → *Add server* → repo URL
`https://github.com/kyesh/fine_grain_access_control`. Ownership is proven by
`https://fgac.ai/.well-known/glama.json` (maintainer email support@fgac.ai);
click *Claim* on the server page once it is indexed.

**awesome-mcp-servers** — https://mcpservers.org/submit. Category:
Productivity / Communication. Name `FGAC.ai — Gmail, Google Sheets & Docs`;
URL `https://fgac.ai`; one-liner:

> Connect AI agents to multiple Gmail accounts and editable Google Sheets and Docs behind deny-by-default, per-file and per-recipient access rules. Hosted MCP server with OAuth — nothing to install.
