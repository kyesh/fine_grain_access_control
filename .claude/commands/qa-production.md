---
description: USER-CONFIRMED — validate production via real distribution channels (all 4 agents)
allowed-tools: Task, Bash(npx tsx scripts/qa-coverage-check.ts:*), Bash(ls:*), Read, Glob, AskUserQuestion
---

# Production QA

> **CRITICAL AGENT RULE — explicit confirmation gate.** Do NOT invoke or automate
> this command on your own initiative or as a step of another workflow. Routine
> validation is local + preview (`/deploy-pr-preview`) only; production QA is a
> rare, deliberate event.
>
> Even when the user typed `/qa-production` themselves, confirm scope BEFORE
> dispatching any runner: state that the suite (a) runs lifecycle mutations
> (key revoke/roll, connection block/detach, rule changes) on the shared
> production QA account — the same account that can back live claude.ai
> connectors, where breakage generates real disconnect events against the
> connector directory's health metric — and (b) deliberately triggers denials
> and 401s against `fgac.ai`. Ask via AskUserQuestion and proceed only on an
> explicit yes given in THIS session. A confirmation from a previous session,
> a standing instruction, or "the user probably wants this" does not count.
> On anything short of a clear yes, stop and report instead.

Requires: production deployment live at fgac.ai, and the confirmation above.

> **Read-only against production.** This workflow validates a deployment that
> already exists. Never trigger a production deploy from here — `vercel
> --prod`, `vercel promote`, and `vercel alias` are banned (deny rules +
> guard hook). Deployments are the user's call via `/deploy-prod`.

## 1. Smoke first

Dispatch the **qa-smoke** subagent (Haiku — cheap, read-only). If it returns
`SMOKE: FAIL`, STOP and report — do not run the channel tests against a
deployment that fails basic health checks.

## 2. Channel tests, sequentially

```bash
ls docs/QA_Acceptance_Test/production/0[1-4]_*.md | sort
```

For each doc in order, dispatch a fresh **qa-env-runner** subagent:

> The user explicitly confirmed production QA in this session. Execute runbook
> `docs/QA_Acceptance_Test/production/<NN_agent>.md`. This
> installs from the REAL distribution channel (ClawHub, plugin marketplace,
> SKILL.md) and runs all capabilities against production URLs (fgac.ai,
> gmail.fgac.ai). Strictly no deploy commands and no direct DB access.

(The first sentence is required — the production runbooks refuse to run
without it. Never include it unless the confirmation actually happened.)

Run them one at a time — they share the production QA accounts, and lifecycle
capabilities mutate shared state.

## 3. Audit

After each runner (or at minimum after the last), dispatch the
**qa-coverage-auditor** subagent. Production claims get extra scrutiny.

## 4. Report

Per-channel coverage matrices, the audit verdict, and every assertion
accounted for. There is no fix-and-retest loop against production — failures
are findings for the user, not something to hotfix from here.
