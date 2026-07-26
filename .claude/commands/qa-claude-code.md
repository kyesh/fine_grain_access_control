---
description: Run all capability tests through Claude Code MCP via tmux
argument-hint: [capability scope, e.g. "04 06"]
allowed-tools: Task, Bash(npx tsx scripts/qa-coverage-check.ts:*), Read, Glob
---

# Claude Code MCP QA

Requires: `/qa-setup` completed, dev server running, tmux + Playwright CLI
available. Optional scope: `$ARGUMENTS` (capability numbers for a targeted
re-test; empty = full suite).

You are the orchestrator. The runner executes; you diagnose and fix.

## 1. Dispatch the runner

Dispatch the **qa-env-runner** subagent:

> Execute runbook `docs/QA_Acceptance_Test/agents/02_claude_code_mcp.md`
> [scope: capabilities `$ARGUMENTS` only, if given]. This environment drives
> Claude Code through tmux and approves the MCP connection with the
> Playwright CLI (`fgac_ui` session) — both via Bash, per the runbook.
> Connection approval happens in the dashboard UI, never via DB writes.

It writes `docs/QA_Acceptance_Test/qa-results.json` and returns only the
coverage matrix and failures.

## 2. Audit

Dispatch the **qa-coverage-auditor** subagent. Treat its findings as failures.

## 3. Fix-and-retest loop (max 3 rounds)

1. Diagnose and fix **in this session** — only the orchestrator edits source.
2. Re-dispatch **qa-env-runner** scoped to *only the failed capabilities*.
   For assertions the runner flagged as flaky ("passed 1/3 runs"), the
   re-test verdict must come from consistent repeat runs, not one lucky pass.
3. Re-dispatch the auditor.

After 3 rounds, stop and hand the remaining failures to the user.

## 4. Report

Final coverage matrix, audit verdict, and remaining failures with masked
evidence. `npx tsx scripts/qa-coverage-check.ts` must exit clean on coverage.
