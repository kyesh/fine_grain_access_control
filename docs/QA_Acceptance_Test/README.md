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
| `/qa-setup` | Bootstrap: pull secrets, dev server, then the `qa-setup-driver` subagent runs the browser flows |
| `/qa-hosted-mcp` | All capabilities via curl → MCP endpoint (dispatches `qa-env-runner`) |
| `/qa-claude-code` | All capabilities via tmux Claude Code MCP (dispatches `qa-env-runner`) |
| `/qa-claude-code-cli` | All capabilities via Claude Code + headless evals (dispatches `qa-env-runner`) |
| `/qa-openclaw` | All capabilities via genuine OpenClaw Docker (dispatches `qa-env-runner`) |
| `/qa-production` | `qa-smoke` first, then all agents via real distribution channels → prod |

Each workflow is orchestrated from the main session, which dispatches subagents
(`.claude/agents/`), audits results via `qa-coverage-auditor` + `scripts/qa-coverage-check.ts`,
and owns all source fixes. Runbooks execute inside the runner subagent — their transcripts
never enter the main context; only the coverage matrix comes back. See CLAUDE.md → "QA
Subagent Architecture".

## Structured results — `qa-results.json`

Every environment run writes `docs/QA_Acceptance_Test/qa-results.json` (gitignored, one
run at a time — the coverage matrix in the QA report is *derived from* this file, not
the other way around):

```json
{
  "run_id": "2026-07-26T14:00:00Z-cc-mcp",
  "environment": "02_claude_code_mcp",
  "results": [
    { "cap": "01", "assertion": "A1", "status": "pass",
      "evidence": "HTTP 200; message id returned; recipient USER_B" },
    { "cap": "06", "assertion": "A9", "status": "skip",
      "reason": "dashboard-only assertion; this environment is headless" }
  ]
}
```

Rules:

- `status` is `pass` | `fail` | `skip`. A `skip` **requires** `reason`; a `pass`/`fail`
  **requires** `evidence` citing observed output.
- `evidence` strings must be masked per CLAUDE.md → "This Repository Is Public": refer
  to test accounts as `USER_A`/`USER_B`, never paste real email addresses, Clerk user
  ids, or proxy keys.
- `npx tsx scripts/qa-coverage-check.ts` is the arbiter of completeness: it parses the
  `### A<n>:` headings in `capabilities/*.md` and exits non-zero listing anything
  missing, duplicated, unknown, or under-evidenced. Assertion counts in prose (this
  file included) are informational; the script is authoritative.
- Capability docs must use the `### A<n>: <title>` heading format — the checker (and
  the runners) parse it.

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
