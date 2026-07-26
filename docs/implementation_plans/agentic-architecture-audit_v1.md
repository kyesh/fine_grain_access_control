# Agentic Architecture Audit & Proposal — v1

Branch: `claude/agentic-architecture-audit-06a514`
Date: 2026-07-26

## Part 1 — Audit of the current architecture

### Inventory (after Antigravity cleanup)

| Layer | What exists | Notes |
|---|---|---|
| Rules | `CLAUDE.md` (single source of truth) | Antigravity `.agent/rules/` deleted; all four rule files were already folded in |
| Workflows | 10 commands in `.claude/commands/` | `/browser-agent`, `/deploy-pr-preview`, `/deploy-prod`, `/qa-setup`, 4× `/qa-*` env runners, `/qa-production`, `/recover-session` |
| Hooks | 1 PreToolUse hook: `guard-local-env.sh` | Blocks improvised DBs, unbranched schema pushes, hand-written `.env`, prod deploys |
| Permissions | `settings.json` deny/ask/allow tiers | Prod deploys and force-pushes denied; env-var mutations ask; read-only ops allowed |
| Skills | `playwright-cli` (+ references) | Used by `/browser-agent` Path B (CDP) |
| Launch | `.claude/launch.json` | `dev:qa` wrapped with Node 22 for `preview_start` |
| Plugin | `.claude-plugin/marketplace.json` | FGAC skill distribution (product surface, not dev tooling) |
| QA docs | `docs/QA_Acceptance_Test/` | setup (3) → capabilities (8 checklists, 48 assertions) → agents (4 runbooks) → production (5) |

### Audit findings

**The Antigravity → Claude Code port was complete.** Every workflow was ported
and *adapted* (not blindly copied): `/recover-session` was rewritten around
Claude Code session artifacts instead of the `.gemini/antigravity/brain` tree,
`/browser-agent` gained the two-path design (built-in browser default, CDP
fallback), and the qa runbooks gained coverage-matrix requirements. Nothing
substantive was dropped. The `.agent/` tree is now deleted; the only remaining
references are historical (`docs/implementation_plans/`, `docs/archive/`).

**Structural observations:**

1. **Everything runs in the main loop, on one model.** A full QA cycle
   (setup + 4 environments × 48 assertions) accumulates tmux captures,
   Playwright snapshots, curl output, and docker logs into a single context.
   That is the main driver of long-session degradation and `/recover-session`
   existing at all — and every mechanical curl assertion burns
   frontier-model tokens.
2. **No subagents are defined.** There is no `.claude/agents/` directory; the
   commands are prompt-expansions into the main context.
3. **Exactly one hook.** `guard-local-env.sh` is excellent (block-with-reason
   pattern), but several CLAUDE.md rules that could be mechanically enforced
   are still "remember to" rules (migration verification, workspace hygiene,
   schema-change → migration coupling).
4. **QA results are prose.** The coverage matrix is a markdown table the model
   writes; nothing machine-checks that all 48 assertions were accounted for.
   `qa-results.json` is referenced by `/recover-session` but no workflow is
   required to write it.
5. **Waiting is done in-context.** `/deploy-pr-preview` polls `vercel ls` and
   `/deploy-prod` (user-run) sleeps 300s — both keep a frontier model idling.

## Part 2 — Proposed subagent architecture

### Principles

- **Context isolation first.** The biggest win is not parallelism — it's that
  each QA environment runner returns *only* a structured coverage matrix
  (~1–2K tokens) instead of dumping its whole transcript into the
  orchestrator.
- **Cost-appropriate models.** Current per-MTok pricing: Haiku 4.5 $1/$5,
  Sonnet 5 $3/$15 (intro $2/$10), Opus 5 $5/$25. Mechanical runbook execution
  does not need an Opus-class orchestrator model.
- **Deterministic where possible.** Coverage checking is a diff, not a
  judgment — do it in a script, and let a model only interpret failures.

### Proposed agents (`.claude/agents/*.md`)

| Agent | Model | Role | Why this model |
|---|---|---|---|
| `qa-env-runner` | **sonnet** | Executes one `docs/QA_Acceptance_Test/agents/NN_*.md` runbook end-to-end (curl/tmux/docker mechanics), writes `qa-results.json`, returns the coverage matrix only | Runbooks are prescriptive; Sonnet 5 is near-Opus on agentic execution at 40% of the cost. All heavy transcript stays in the subagent |
| `qa-smoke` | **haiku** | Production smoke test (`production/00_smoke_test.md`): health checks, unauthenticated endpoint probes, curl status assertions | Pure mechanical curl + status-code comparison; 5× cheaper than Sonnet |
| `deploy-watcher` | **haiku** | Poll `vercel ls` until Ready/Error; on Error fetch build logs via the Vercel API and return a classified failure (migration SQL / branch limit / TS build / env var) | Long-poll + log grep + classification against a fixed taxonomy — no reasoning needed |
| `qa-setup-driver` | **inherit** (Opus-class) | Drives `/qa-setup` browser flows: Clerk/Google OAuth, delegation, key creation, rules config | Real-browser flows are the flakiest, highest-judgment step; a failed setup silently invalidates all downstream QA, so don't cheap out here |
| `qa-coverage-auditor` | **sonnet** | Adversarial pass over `qa-results.json`: verifies every assertion in `capabilities/` is accounted for, challenges "passed" claims lacking evidence, flags skips without reasons | Second, skeptical context catches the classic failure mode ("marked passing on assumption") the runbooks already warn about |

The **orchestrator stays the main session** (Opus/Fable): it runs `/qa-setup`
(via `qa-setup-driver`), dispatches runners, reads matrices, diagnoses
failures, edits code, and decides what to re-run. Only the orchestrator ever
edits source.

### Honest constraints on parallelism

Fan-out of all 4 environment runners at once is tempting but unsafe today:

- All environments share **one dev server, one Neon branch, and the same two
  QA accounts/keys/rules** — capability 06 (connection lifecycle) and 07 (key
  lifecycle) *mutate* the state other environments assert against.
- The Browser pane and the CDP Chrome profile are single-instance; only one
  browser-driving agent can run at a time.

Recommendation: run environments **sequentially but each in its own subagent**
(the isolation/cost win is preserved), and allow one targeted parallelism:
`qa-hosted-mcp` (curl) and `qa-claude-code-cli` (headless evals) may run
concurrently **only for read-only capabilities (01–05, 08)**, with lifecycle
capabilities (06–07) serialized at the end. Full parallelism becomes safe if
setup is extended to provision per-environment key sets — worth a follow-up.

### Structured results (prerequisite for the auditor)

Standardize what every runner writes to
`docs/QA_Acceptance_Test/qa-results.json`:

```json
{
  "run_id": "2026-07-26T14:00:00Z-cc-mcp",
  "environment": "02_claude_code_mcp",
  "results": [
    {"cap": "01", "assertion": "A1", "status": "pass", "evidence": "HTTP 403 …"}
  ]
}
```

Add `scripts/qa-coverage-check.ts`: parses `capabilities/*.md` assertion IDs,
diffs against `qa-results.json`, exits non-zero listing anything unaccounted
for. The auditor agent then only argues about *evidence quality*, not
arithmetic — and the script can also run as a Stop hook (Part 4).

### Cost sketch (one full local QA cycle)

Rough, assuming ~150K tokens of transcript per environment runner and ~20K
returned to the orchestrator:

| Design | Frontier-model tokens | Cheap-model tokens |
|---|---|---|
| Today (all in main loop) | ~700K+ Opus/Fable, plus degraded-context retries | 0 |
| Proposed | ~100K (orchestrate + diagnose + setup) | ~600K Sonnet + ~50K Haiku |

That is roughly a 3–5× cost reduction on a QA cycle *and* a main context that
stays small enough to survive the whole cycle without compaction.

## Part 3 — Agentic loops worth adding

1. **Deploy-watch loop** (`/deploy-pr-preview` step 6–7): push → dispatch
   `deploy-watcher` (background) → orchestrator keeps working → on Error
   notification, apply the classified fix → push → re-dispatch. Bounded at 3
   iterations before handing back to the user. Replaces in-context polling.
2. **Fix-and-retest loop**: when a runner reports a failed capability, fix in
   the main loop, then re-dispatch a runner scoped to *only the failed
   capability* ("run capability 04 assertions per runbook 02") rather than
   re-running the full suite. Loop until green or 3 attempts.
3. **Flake dry-run loop**: an assertion that flips pass/fail across runs gets
   re-run twice by a fresh runner before being reported — "loop until dry"
   applied to flaky browser/tmux steps.
4. **Scheduled production canary** (optional): a scheduled cloud agent runs
   `qa-smoke` (Haiku) against fgac.ai daily and only notifies on failure.
   Read-only, so it's safe to automate; `/qa-production`'s full matrix stays
   user-triggered.

## Part 4 — Hook improvements

Extend the existing block-with-reason pattern (`guard-local-env.sh` stays):

| Hook | Event / matcher | Behavior |
|---|---|---|
| `check-schema-migration.sh` | PostToolUse on Edit\|Write of `src/db/schema.ts` | Emit reminder: schema changed → `npm run db:generate` + `db:push` required (Database Rules 4/8); nag again at Stop if no new `NNNN_*.sql` appeared |
| `verify-migration-file.sh` | PostToolUse on Bash matching `db:generate` | Verify a new `src/db/migrations/NNNN_*.sql` exists and follows naming; block-warn if not (automates Rule 8a/8b) |
| `guard-pkill.sh` (fold into guard-local-env) | PreToolUse Bash | Block bare `pkill chrome` / `pkill -f chrome` without `playwright_user_data` (Session Hygiene 8 — protects the user's real browser) |
| `guard-prod-env-file.sh` (fold in) | PreToolUse Bash | Block `vercel env pull` targeting `.env.production.local` or `.env.local --environment=production` — the exact foot-gun the Production Credentials section documents |
| `session-start-env-check.sh` | SessionStart | Run `npm run env:check` (fast) and surface the resolved DB host + Clerk mode as context, so "am I pointed at prod?" is answered before the first command |
| `stop-hygiene-check.sh` | Stop | Warn if untracked files > 20 or binaries (png/pdf) sit in the repo root (Session Hygiene 5/7); during QA also run `scripts/qa-coverage-check.ts` if a run is in progress |

All are sub-second shell scripts; none call a model.

## Part 5 — Implementation plan

1. **Phase 1 (mechanical, low risk):** add the five hooks + register in
   `settings.json`; add `scripts/qa-coverage-check.ts`; define the
   `qa-results.json` schema in `docs/QA_Acceptance_Test/README.md`.
2. **Phase 2 (agents):** create `.claude/agents/{qa-env-runner,qa-smoke,deploy-watcher,qa-coverage-auditor,qa-setup-driver}.md`;
   update the four `/qa-*` commands and `/qa-production` to dispatch their
   runner instead of executing inline; update `/deploy-pr-preview` to use
   `deploy-watcher`.
3. **Phase 3 (loops):** add the fix-and-retest and flake-dry-run guidance to
   the runner agent definitions; optionally register the scheduled smoke
   canary.
4. **Phase 4 (unlock parallelism):** extend `/qa-setup` to provision
   per-environment key sets, then let read-only capabilities fan out.

### Risks

- Subagents inherit the same permission system, but the hooks are the real
  guardrails — Phase 1 before Phase 2 is deliberate.
- Sonnet runners following runbooks literally is a feature, but they must be
  told to *report* anomalies, not improvise fixes; the agent definitions must
  say "you never edit source; return findings."
- The coverage script must parse assertion IDs robustly or it becomes a false
  sense of safety; keep the auditor agent as the semantic backstop.
