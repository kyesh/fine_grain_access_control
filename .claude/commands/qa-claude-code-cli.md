---
description: Run all capability tests through Claude Code CLI local scripts (headless `claude -p` evals)
argument-hint: [--filter A1 | capability scope]
allowed-tools: Task, Bash(npx tsx scripts/qa-coverage-check.ts:*), Read, Glob
---

# Claude Code CLI QA

Requires: `/qa-setup` completed, dev server running. Optional scope:
`$ARGUMENTS` (an eval `--filter` or capability numbers; empty = full suite).

You are the orchestrator. The runner executes; you diagnose and fix.

## 1. Dispatch the runner

Dispatch the **qa-env-runner** subagent:

> Execute runbook `docs/QA_Acceptance_Test/agents/03_claude_code_cli.md`
> [scope: `$ARGUMENTS`, if given]. This environment is two-phase:
>
> **Phase 1 — auth (once):** `bash test/qa-envs/cc-cli/reset.sh`, then
> `FGAC_ROOT_URL=http://localhost:3000 node test/qa-envs/cc-cli/.claude/skills/fgac/scripts/auth.js --action login`,
> approve the pending connection in the dashboard via the Playwright CLI
> (UI only — never DB writes), then verify
> `cat ~/.openclaw/fgac/fgac-credentials.json | jq '.proxy_key, .key_label'`
> succeeds (do not print the key value).
>
> **Phase 2 — headless evals:**
> `cd test/qa-envs/cc-cli && bash evals/run_evals.sh` (add `--filter <id>`
> for a scoped run). The suite uses `claude -p` with `--output-format json`;
> map its per-test results onto capability assertions in qa-results.json.

It writes `docs/QA_Acceptance_Test/qa-results.json` and returns only the
coverage matrix and failures.

New test cases go in `test/qa-envs/cc-cli/evals/test_cases.json` — that is an
orchestrator (source) change, not a runner action. The tmux interactive
fallback exists for UI-only assertions (slash-command UI, skill banner); the
runbook covers it.

## 2. Audit

Dispatch the **qa-coverage-auditor** subagent. Treat its findings as failures.

## 3. Fix-and-retest loop (max 3 rounds)

1. Diagnose and fix **in this session** — only the orchestrator edits source
   (including eval test cases).
2. Re-dispatch **qa-env-runner** with a `--filter` scoped to the failures.
3. Re-dispatch the auditor.

After 3 rounds, stop and hand the remaining failures to the user.

## 4. Report

Final coverage matrix, audit verdict, and remaining failures with masked
evidence. `npx tsx scripts/qa-coverage-check.ts` must exit clean on coverage.
