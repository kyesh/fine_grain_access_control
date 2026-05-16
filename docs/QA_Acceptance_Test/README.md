# FGAC.ai QA Acceptance Test Suite

## Execution Model

```
┌──────────────────────────────────────────────────────────────┐
│                        SETUP (Layer 1)                       │
│  Browser agent configures: users, keys, rules, emails        │
│  Workflow: /qa-setup                                         │
└──────────────────────────┬───────────────────────────────────┘
                           │
     ┌─────────┬───────────┼───────────┬─────────┐
     ▼         ▼           ▼           ▼         │
  Hosted    Claude Code  Claude Code  OpenClaw   │
  MCP       MCP          CLI          (Docker)   │
  (curl)    (tmux)       (scripts)    (gateway)  │
  ALL caps  ALL caps     ALL caps     ALL caps   │
     │         │           │           │    LOCAL DEV (Layer 2)
     └─────────┼───────────┼───────────┘
               │           │
     ┌─────────┼───────────┼───────────┐
     ▼         ▼           ▼           ▼
  Hosted    CC MCP via   CC CLI via   OpenClaw via
  MCP via   marketplace  SKILL.md     ClawHub
  curl      install      Option B     install
  ALL caps  ALL caps     ALL caps     ALL caps
                   PRODUCTION (Layer 3)
                   Install from REAL distribution channels
```

## Directory Structure

```
setup/          → Layer 1: Dashboard configuration via /browser-agent
capabilities/   → Shared assertion checklists (WHAT to verify)
agents/         → Layer 2: Per-agent test runbooks (HOW to verify locally)
production/     → Layer 3: Per-agent test runbooks (HOW to verify in prod)
archive/        → Retired one-time-fix tests
```

## How It Works

1. **`setup/`** docs describe dashboard actions to configure the QA baseline (keys, rules, linked emails). Run once per QA cycle via `/qa-setup`.

2. **`capabilities/`** docs are **assertion checklists** — they define WHAT to verify (e.g., "send to blocked address returns 403") but NOT how. They are never run standalone.

3. **`agents/`** docs are **execution runbooks** — each one describes HOW to run ALL capability assertions through one specific agent runtime. Every agent doc covers every capability.

4. **`production/`** docs mirror `agents/` but install from **real distribution channels** (ClawHub, plugin marketplace) and run against production URLs (`fgac.ai`, `gmail.fgac.ai`).

## Workflows

| Workflow | Description |
|----------|-------------|
| `/qa-setup` | Bootstrap: pull secrets, browser agent setup |
| `/qa-hosted-mcp` | All capabilities via curl → MCP endpoint |
| `/qa-claude-code` | All capabilities via tmux Claude Code MCP |
| `/qa-claude-code-cli` | All capabilities via Claude Code + local scripts |
| `/qa-openclaw` | All capabilities via genuine OpenClaw Docker |
| `/qa-production` | All agents via real distribution channels → prod |

## Secrets

Test credentials are stored in 1Password vault `FGAC`. Run `npm run qa:secrets` (or `bash scripts/qa-secrets.sh`) to populate the gitignored `.qa_test_emails.json` file.

## Dependencies

```
setup/01 → setup/02 → setup/03
                ↓
    ┌───────────┼───────────┬───────────┐
    ▼           ▼           ▼           ▼
 agents/01   agents/02   agents/03   agents/04
 (hosted)    (CC MCP)    (CC CLI)    (OpenClaw)
    ↓           ↓           ↓           ↓
 prod/01     prod/02     prod/03     prod/04
```
