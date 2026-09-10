# Neon branch pruning: time-based, decoupled from git

**Branch:** `claude/adoring-keller-6c98ea` · **Date:** 2026-09-10

## Problem

The daily prune kept deleting almost nothing while the bill grew. The
2026-09-10 run deleted 6 branches and kept 13, and **17 of the kept branches
were held by the "checked out in a git worktree" rule** — worktree directories
left behind by sessions that had finished and merged weeks earlier.

The mechanism was a cycle the pruner could never break:

1. A session creates a worktree and a Neon branch.
2. The work merges; nothing removes the worktree directory.
3. The directory keeps the git branch checked out.
4. The pruner sees a worktree pin and keeps the database branch — forever.

The classifier was doing exactly what it was written to do. The defect was the
premise: it made staleness a property of *git history* when the thing being
billed is *a database nobody is connected to*. At $1.50/branch-month past the
10 included on the Launch plan, 20 branches were costing ~$15/month to hold
work that had shipped.

Ken's call (2026-09-10): prune on time and activity, guard `main`, and make
worktree cleanup a separate, report-only concern.

## Policy

Delete a Neon branch when **it is older than 24h AND its compute has been idle
more than 6h**. Nothing else is consulted — not merge status, not worktree
checkouts, not whether a PR is open.

Guards that remain:

| guard | why |
| --- | --- |
| primary/default branch, or exactly `main` | never disposable. Exact match — a `includes('main')` test once hid every ger·main / do·main branch from the output |
| `protected` in Neon | the opt-out for a branch that must outlive the timers; set it in the Neon console |
| compute `current_state === 'active'` | a live dev server or in-flight preview request must not lose its database mid-run |
| unreadable `created_at` | age is the one fact nothing else can infer; refuse to guess |
| endpoints API unreadable | aborts before deleting — without `last_active` every branch looks idle |

**Idleness comes from the compute endpoint's `last_active`, never the branch's
`updated_at`.** Measured on the live project: `updated_at` is bumped by
unrelated project-level metadata operations — deleting a sibling branch moved
`main`'s and `preview/claude/growth-prospecting`'s to <1h — while their real
last activity was 0h and 7.9h respectively. Using `updated_at` would make every
branch look permanently fresh. `neonctl` has no `endpoints` subcommand in the
installed version, so the runner reads `/projects/<id>/endpoints` through
`neonctl api`.

A branch with no endpoint at all has never served a query; it is treated as
idle for its entire life.

## What this trades away

Deletion is recoverable in the sense that matters — `npm run db:branch`
recreates a branch from main, and a preview branch comes back on the PR's next
deploy — but not in these senses, which are now documented in CLAUDE.md:

- **An open PR's preview is not exempt.** If its URL has been quiet 6h, the
  database goes and the existing preview deployment 500s until redeployed.
- **A worktree resumed after a day needs `npm run db:branch` again.** Its
  `.env.local` still names the deleted branch.
- **Accumulated QA state does not survive** — the replacement is a fresh copy
  of main, so approved connections, proxy keys and rules must be re-established
  from `docs/QA_Acceptance_Test/setup/`.

## Changes

- `scripts/lib/neon-branch-classifier.ts` — rewritten. `classifyNeonBranch(branch,
  endpoints, now)` is pure and takes no `GitState`; `sanitize()` and the
  git-shape mapping are gone with it.
- `scripts/cleanup-neon-branches.ts` — drops the git fetch, `ls-remote`,
  `for-each-ref`, `worktree list` and `gh pr list` calls entirely; fetches
  compute endpoints instead and aborts if they cannot be read.
- `scripts/test-neon-branch-cleanup.ts` — rewritten around age/idle boundaries
  (23.9h vs 24.1h, 5.9h vs 6.1h), the running-compute and `protected` guards,
  degraded inputs, and the retained ger·main regression guard.
- `scripts/report-stale-worktrees.ts` — **new, report-only.** Classifies each
  worktree as finished (merged + clean), merged-but-dirty, or still-unmerged,
  and prints ready-to-paste `git worktree remove` lines for the first group. It
  never removes anything: a clean merged directory can still be a live
  session's cwd.
- `npm run db:prune-branches` and `npm run worktrees:report` added.
- `scripts/branch-db.ts`, `CLAUDE.md`, `.claude/commands/deploy-pr-preview.md`,
  `.claude/agents/deploy-watcher.md` — comments and docs updated. The
  branch-limit self-heal path now notes that a prune correctly frees nothing
  when every branch is under 24h old, which is a capacity problem rather than a
  broken prune.

## Result

Dry run against live state: **12 deletions, 7 kept, `main` skipped** — 20
branches down to 8, i.e. 0 billable against the 10 included, from ~$15/month.
Kept for the right reasons: six branches under the 24h floor, and
`preview/claude/epic-brattain-f21f5d` at 22.6h.

`npm run worktrees:report` finds 15 finished worktree directories, 4 merged
but dirty, and 7 carrying unmerged work. These no longer cost anything in
database billing; removing them is now purely filesystem hygiene, and stays
Ken's call.
