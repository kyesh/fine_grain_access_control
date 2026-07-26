# Agentic Architecture Audit & Proposal — v2

Branch: `claude/agentic-architecture-audit-06a514`
Date: 2026-07-26

**Changes from v1:** incorporates the merge of `fix/vercel-guard-readonly`,
which landed after v1 was written. The audit inventory now reflects two hooks
instead of one; the Part 4 hook proposal is rebased on the expanded hook
family (the vercel-guard scoping fix and the new `guard-public-content.sh`);
and a public-content rule is added to the subagent design constraints, since
QA runners and deploy watchers post to GitHub. Parts 2–3 (subagents, loops)
are otherwise unchanged.

## Part 1 — Audit of the current architecture

### Inventory (after Antigravity cleanup + `fix/vercel-guard-readonly` merge)

| Layer | What exists | Notes |
|---|---|---|
| Rules | `CLAUDE.md` (single source of truth) | Antigravity `.agent/` deleted; new "This Repository Is Public" section documents the customer-data rule |
| Workflows | 10 commands in `.claude/commands/` | `/browser-agent`, `/deploy-pr-preview`, `/deploy-prod`, `/qa-setup`, 4× `/qa-*` env runners, `/qa-production`, `/recover-session` |
| Hooks | 2 PreToolUse hooks | `guard-local-env.sh` (improvised DBs, unbranched schema pushes, hand-written `.env`, prod deploys — now correctly scoped to deploy-shaped vercel commands only) and `guard-public-content.sh` (blocks `gh issue/pr create\|edit\|comment`, `gh gist create`, `gh release create` when the body carries a real email, proxy key, or Clerk user id) |
| Permissions | `settings.json` deny/ask/allow tiers | Prod deploys and force-pushes denied; env-var mutations ask; read-only ops allowed |
| Skills | `playwright-cli` (+ references) | Used by `/browser-agent` Path B (CDP) |
| Launch | `.claude/launch.json` | `dev:qa` wrapped with Node 22 for `preview_start` |
| Plugin | `.claude-plugin/marketplace.json` | FGAC skill distribution (product surface, not dev tooling) |
| QA docs | `docs/QA_Acceptance_Test/` | setup (3) → capabilities (8 checklists, 48 assertions) → agents (4 runbooks) → production (5) |

### Audit findings

**The Antigravity → Claude Code port was complete.** Every workflow was ported
and *adapted* (not blindly copied): `/recover-session` was rewritten around
Claude Code session artifacts, `/browser-agent` gained the two-path design
(built-in browser default, CDP fallback), and the qa runbooks gained
coverage-matrix requirements. The `.agent/` tree is deleted; the only
remaining references are historical (`docs/implementation_plans/`,
`docs/archive/`). A mirror file resurrected by the
`fix/vercel-guard-readonly` merge was removed again — **there is no mirror
tree to keep in sync anymore; new rules go in CLAUDE.md only.**

**The hook family is now a proven pattern.** Both hooks follow
block-with-reason (exit 2, remediation text on stderr), and the vercel-guard
fix demonstrates the failure mode to design against: guards must match the
*shape* of the dangerous command, not a keyword — the original `--prod` match
blocked the read-only verification commands `/deploy-prod` itself needs.
Every hook proposed in Part 4 gets a positive and negative test list for both
directions, as `fix/vercel-guard-readonly` did (eight and ten cases
respectively).

**Structural observations (unchanged from v1):**

1. **Everything runs in the main loop, on one model.** A full QA cycle
   (setup + 4 environments × 48 assertions) accumulates tmux captures,
   Playwright snapshots, curl output, and docker logs into a single context —
   the main driver of long-session degradation and `/recover-session`
   existing at all — and every mechanical curl assertion burns frontier-model
   tokens.
2. **No subagents are defined.** There is no `.claude/agents/` directory; the
   commands are prompt-expansions into the main context.
3. **Several CLAUDE.md rules are still "remember to" rules** that could be
   mechanically enforced (migration verification, workspace hygiene,
   schema-change → migration coupling). The public-content rule shows the
   payoff of converting one: it was written *after* a real leak.
4. **QA results are prose.** The coverage matrix is a markdown table the
   model writes; nothing machine-checks that all 48 assertions were accounted
   for. `qa-results.json` is referenced by `/recover-session` but no workflow
   is required to write it.
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
- **Hooks bind subagents too.** Subagents inherit the project's PreToolUse
  hooks, so `guard-local-env.sh` and `guard-public-content.sh` apply to every
  runner automatically. This is the safety argument for doing hook work
  (Phase 1) before agent work (Phase 2): a guard added to the family protects
  the whole fleet at once.

### Proposed agents (`.claude/agents/*.md`)

| Agent | Model | Role | Why this model |
|---|---|---|---|
| `qa-env-runner` | **sonnet** | Executes one `docs/QA_Acceptance_Test/agents/NN_*.md` runbook end-to-end (curl/tmux/docker mechanics), writes `qa-results.json`, returns the coverage matrix only | Runbooks are prescriptive; Sonnet 5 is near-Opus on agentic execution at 40% of the cost. All heavy transcript stays in the subagent |
| `qa-smoke` | **haiku** | Production smoke test (`production/00_smoke_test.md`): health checks, unauthenticated endpoint probes, curl status assertions | Pure mechanical curl + status-code comparison; 5× cheaper than Sonnet |
| `deploy-watcher` | **haiku** | Poll `vercel ls` until Ready/Error; on Error fetch build logs via the Vercel API and return a classified failure (migration SQL / branch limit / TS build / env var) | Long-poll + log grep + classification against a fixed taxonomy — no reasoning needed. Uses only the read-only vercel commands the fixed guard now correctly permits |
| `qa-setup-driver` | **inherit** (Opus-class) | Drives `/qa-setup` browser flows: Clerk/Google OAuth, delegation, key creation, rules config | Real-browser flows are the flakiest, highest-judgment step; a failed setup silently invalidates all downstream QA, so don't cheap out here |
| `qa-coverage-auditor` | **sonnet** | Adversarial pass over `qa-results.json`: verifies every assertion in `capabilities/` is accounted for, challenges "passed" claims lacking evidence, flags skips without reasons | Second, skeptical context catches the classic failure mode ("marked passing on assumption") the runbooks already warn about |

The **orchestrator stays the main session** (Opus/Fable): it runs `/qa-setup`
(via `qa-setup-driver`), dispatches runners, reads matrices, diagnoses
failures, edits code, and decides what to re-run. Only the orchestrator ever
edits source.

**Public-repo constraint (new in v2):** every agent definition includes the
rule from CLAUDE.md's "This Repository Is Public" section — evidence fields
in `qa-results.json` and anything a runner might surface toward a GitHub
issue or PR must mask real emails, Clerk user ids, and proxy keys. The QA
test accounts come from `.qa_test_emails.json` (real Google accounts), so
runner evidence strings must refer to them as `USER_A` / `USER_B`, never by
address. `guard-public-content.sh` is the backstop, but agents should not
generate content that trips it.

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
   (The vercel-guard fix was a prerequisite for this: the watcher lives on
   `vercel ls --prod` / `inspect` / `logs`, which the old guard blocked.)
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

Rebased on the now-two-member hook family. `guard-local-env.sh` (with the
corrected vercel scoping) and `guard-public-content.sh` stay as-is. Design
rules learned from `fix/vercel-guard-readonly`, applied to everything below:

- Match the **shape** of the dangerous command, not a keyword — enumerate the
  safe subcommands a broad pattern would otherwise catch.
- Every guard ships with a listed set of positive *and* negative test cases.
- Consolidate related Bash guards into the existing scripts rather than
  multiplying PreToolUse entries (each entry runs on every Bash call).

| Hook | Event / matcher | Behavior |
|---|---|---|
| `check-schema-migration.sh` | PostToolUse on Edit\|Write of `src/db/schema.ts` | Emit reminder: schema changed → `npm run db:generate` + `db:push` required (Database Rules 4/8); nag again at Stop if no new `NNNN_*.sql` appeared |
| `verify-migration-file.sh` | PostToolUse on Bash matching `db:generate` | Verify a new `src/db/migrations/NNNN_*.sql` exists and follows naming; block-warn if not (automates Rule 8a/8b) |
| *(fold into `guard-local-env.sh`)* | PreToolUse Bash | Block bare `pkill chrome` / `pkill -f chrome` without `playwright_user_data` (Session Hygiene 8 — protects the user's real browser). Negative cases: `pkill -f 'chrome.*playwright_user_data'` must pass |
| *(fold into `guard-local-env.sh`)* | PreToolUse Bash | Block `vercel env pull` targeting `.env.production.local` or `.env.local --environment=production` — the exact foot-gun the Production Credentials section documents. Negative cases: pulls to `.secrets/prod.env` and `.env.local --environment=development` must pass |
| `session-start-env-check.sh` | SessionStart | Run `npm run env:check` (fast) and surface the resolved DB host + Clerk mode as context, so "am I pointed at prod?" is answered before the first command |
| `stop-hygiene-check.sh` | Stop | Warn if untracked files > 20 or binaries (png/pdf) sit in the repo root (Session Hygiene 5/7); during QA also run `scripts/qa-coverage-check.ts` if a run is in progress |

Deliberately **not** proposed: overlapping with `guard-public-content.sh` —
it already covers the GitHub-publication surface, and its allowlist approach
(example/test domains, `support@`, `noreply@`) is the right place to extend
if QA evidence strings ever need more nuance.

All are sub-second shell scripts; none call a model.

## Part 5 — Implementation plan

1. **Phase 1 (mechanical, low risk):** add the four new hook scripts + the
   two `guard-local-env.sh` extensions, each with its test-case list;
   register in `settings.json`; add `scripts/qa-coverage-check.ts`; define
   the `qa-results.json` schema in `docs/QA_Acceptance_Test/README.md`.
2. **Phase 2 (agents):** create `.claude/agents/{qa-env-runner,qa-smoke,deploy-watcher,qa-coverage-auditor,qa-setup-driver}.md`
   (each carrying the public-repo evidence-masking rule); update the four
   `/qa-*` commands and `/qa-production` to dispatch their runner instead of
   executing inline; update `/deploy-pr-preview` to use `deploy-watcher`.
3. **Phase 3 (loops):** add the fix-and-retest and flake-dry-run guidance to
   the runner agent definitions; optionally register the scheduled smoke
   canary.
4. **Phase 4 (unlock parallelism):** extend `/qa-setup` to provision
   per-environment key sets, then let read-only capabilities fan out.

### Risks

- Subagents inherit the same permission system and both existing hooks, but
  Phase 1 before Phase 2 remains deliberate: guards land before the fleet
  that relies on them.
- Sonnet runners following runbooks literally is a feature, but they must be
  told to *report* anomalies, not improvise fixes; the agent definitions must
  say "you never edit source; return findings."
- The coverage script must parse assertion IDs robustly or it becomes a false
  sense of safety; keep the auditor agent as the semantic backstop.
- New guards can repeat the original vercel-guard mistake (over-broad
  matching that blocks legitimate workflow steps); the per-guard negative
  test cases exist to catch exactly that before it ships.
