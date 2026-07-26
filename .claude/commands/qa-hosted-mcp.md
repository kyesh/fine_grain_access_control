---
description: Run all capability tests through the Hosted MCP interface
argument-hint: [capability scope, e.g. "04 06"]
allowed-tools: Task, Bash(npx tsx scripts/qa-coverage-check.ts:*), Read, Glob
---

# Hosted MCP QA

Requires: `/qa-setup` completed, dev server running. Optional scope: `$ARGUMENTS`
(capability numbers for a targeted re-test; empty = full suite).

You are the orchestrator. The runner executes; you diagnose and fix.

## 1. Dispatch the runner

Dispatch the **qa-env-runner** subagent:

> Execute runbook `docs/QA_Acceptance_Test/agents/01_hosted_mcp.md`
> [scope: capabilities `$ARGUMENTS` only, if given]. This environment is
> curl-based against the local MCP endpoint.

It writes `docs/QA_Acceptance_Test/qa-results.json` and returns only the
coverage matrix and failures.

## 2. Audit

Dispatch the **qa-coverage-auditor** subagent. It runs the coverage check and
challenges weak evidence. Treat its findings as failures.

## 3. Fix-and-retest loop (max 3 rounds)

For runner failures and auditor findings:

1. Diagnose and fix **in this session** — only the orchestrator edits source.
   Schema changes follow the Database Rules (`db:branch` first).
2. Re-dispatch **qa-env-runner** scoped to *only the failed capabilities* —
   never re-run the full suite for a targeted fix.
3. Re-dispatch the auditor.

After 3 rounds, stop and hand the remaining failures to the user with your
diagnosis.

## 4. Report

Give the user: the final coverage matrix, the audit verdict, and each
remaining failure with the runner's (masked) evidence. Completeness arbiter:
`npx tsx scripts/qa-coverage-check.ts` must exit clean on coverage.
