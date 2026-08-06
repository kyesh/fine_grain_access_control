# Connectors Directory — Listing Copy & Portal Answers

Draft answers for every step of the submission portal
(claude.ai/admin-settings/directory/submissions/new). Paste-ready; edit taste,
not facts.

## Listing step

**Server name** (≤100 chars)
> FGAC.ai

**Tagline** (≤55 chars — pick one)
> 1. `Gmail & Sheets for agents — on your terms` (41)
> 2. `A permission layer for agents in your inbox` (43)
> 3. `Deny-by-default Gmail & Sheets access for AI` (44)

Recommended: #1 (leads with capability, ends with the differentiator).

**Description** (≤2,000 chars)

> FGAC.ai (Fine-Grained Access Control) lets AI agents work inside your Gmail
> and Google Sheets without handing them your whole Google account.
>
> Connect once, then decide exactly what agents can do. Every request an agent
> makes passes through FGAC's rule engine before it touches Google — deny by
> default, allow on your terms:
>
> • **Read rules** hide sensitive mail from agents: block by Gmail label, or
> by content patterns (2FA codes, password resets, financial alerts) — the
> agent sees an "access restricted" notice, never the message.
> • **Send whitelist** — agents can only email addresses and domains you
> approve. No whitelist, no outbound mail. Deletion is never possible: no
> FGAC tool can delete anything.
> • **Per-spreadsheet grants** — expose individual Sheets read-only or
> read-write; everything else is invisible.
> • **Agent profiles** — bundle rules into scoped identities. Your research
> agent and your inbox agent don't share permissions.
> • **Pending approval** — every new agent connection starts inert until you
> approve it from your dashboard.
> • **Multi-account** — teammates can delegate their inboxes to your agent
> with their own rules, revocable in one click. No password sharing.
>
> Under the hood, agents get read tools that run without friction
> (annotated read-only), guarded write tools, and a rule-checked raw API
> escape hatch covering the full Gmail and Sheets API surface. Your data is
> never stored or used for training; see fgac.ai/privacy.
>
> Free for personal use. Connected in under a minute.

(~1,450 chars — room to grow.)

**Categories** (1-5): Productivity; Email; Spreadsheets/Data; Developer Tools
(pick what the portal's actual taxonomy offers — Productivity first).

**Documentation URL**: `https://fgac.ai/docs`
**Privacy policy URL**: `https://fgac.ai/privacy`
**Support contact**: `fgac-ai@googlegroups.com`

**Icon**: square PNG. `public/logo-square.png` is currently 376×379 — crop to
exactly square and export at 512×512 before uploading.

**URL slug** (PERMANENT — cannot change after publication)
> Recommended: `fgac` (short, matches domain). Alternative: `fgac-ai`.

## Connection step

- Server URL: `https://fgac.ai/api/mcp` (https ✓)
- Transport: **Streamable HTTP**
- Same URL for every user: **Yes**

## Use cases step

- Primary use cases: inbox triage and summarization with sensitive mail
  shielded; guarded email sending (whitelisted recipients only); reading and
  updating exposed spreadsheets; delegated multi-inbox workflows for teams.
- What users need first: a Google account (Gmail); sign-in happens during
  OAuth. To grant access they visit their FGAC dashboard once to approve the
  connection and set rules. Free tier — no plan required.
- Reads data, writes data, or both: **Both** (reads mail/sheets; writes are
  limited to whitelisted sends and Read & Write spreadsheets).

## Company step

- Company: FGAC.ai — website `https://fgac.ai`
- Contact: pre-filled from the submitting account.

## Authentication step

- **OAuth with Dynamic Client Registration** (`oauth_dcr`) — our authorization
  server is Clerk at `clerk.fgac.ai`; DCR + PKCE S256 supported out of the box;
  discovery at `/.well-known/oauth-authorization-server` and
  `/.well-known/oauth-protected-resource/mcp` (resource includes the
  `/api/mcp` path).
- Note for later: if directory traffic makes DCR client accumulation a
  problem, migrate to CIMD or Anthropic-held credentials
  (mcp-review@anthropic.com), per docs/implementation_plans/connector-approval-audit_v2.md.

## Data handling step

- The API called is **our own first-party service** (fgac.ai), which proxies
  Google's Gmail/Sheets APIs strictly on the user's own OAuth grant, applying
  the user's access rules. MCP domain (fgac.ai) = service domain.
- Personal health data: **No**. Sponsored content: **No**.

## Test & launch step

- Use docs/connector_submission/reviewer_runbook.md Part 2 verbatim, with real
  credentials filled in from 1Password.
- Attestation "you have run every tool yourself": true — QA runs exercised all
  13 tools through the MCP endpoint (docs/QA_Acceptance_Test/qa-results.json);
  do one final custom-connector pass from Claude.ai before submitting.

## Compliance step (7 acknowledgments)

All seven apply cleanly: directory guidelines ✓; first-party API ✓; no
financial transactions ✓; no AI media generation ✓; no prompt-injection
patterns in tool descriptions (linted in CI) ✓; no conversation-data
collection beyond tool needs ✓; public documentation live at fgac.ai/docs ✓.

## Pre-submission checklist (final pass)

- [ ] Google Group accepts posts from non-members (tested with an outside email)
- [ ] fgac.ai/docs live in production
- [ ] Reviewer account built + dry-run (reviewer_runbook.md Part 1, step 5)
- [ ] Icon cropped square, 512×512 PNG
- [ ] No Vercel firewall/challenge rules blocking 160.79.104.0/21
- [ ] Final custom-connector smoke test from Claude.ai (all tools listed with
      annotations; one read, one denied read, one send, one denied send)
