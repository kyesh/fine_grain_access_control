# Neon branch pruning: time-based, decoupled from git — revision 2

**Branch:** `claude/adoring-keller-6c98ea` · **Date:** 2026-09-10 · Supersedes v1

v1 (see `claude-adoring-keller-6c98ea_v1.md`) covers the policy change itself:
delete a branch older than 24h whose compute has been idle more than 6h, with
`main`, `protected`, and running-compute as the only guards. That is unchanged.

This revision adds the **accountability output** Ken asked for: every un-pruned
branch must be listed with the reason it survived.

## Why

After the first run the project sat at 10 branches while only three mapped to
open PRs. The per-branch `⏭️  Keeping …` lines carried the reason but nothing
totalled them, so "why is this number 10 when I have 3 active branches?" took a
manual join across `neonctl`, `gh pr list`, and arithmetic. The answer turned
out to be benign — preview branches for freshly merged PRs, all inside the 24h
floor — but nothing in the report said so.

## Changes

- **`classifyNeonBranch` now returns `metrics` alongside the verdict**:
  `ageHours`, `idleHours`, and `eligibleInHours` — how long until a kept branch
  becomes deletable, `null` when no timer will get it there (running compute,
  `protected`, unreadable age). Deletion logic is untouched; this exists so the
  table cannot drift from the rules by recomputing them separately.
  `eligibleInHours` is `max(waitForAge, waitForIdle)` because both timers must
  expire, and it assumes the branch stays untouched — connecting to it resets
  the idle clock.
- **The runner prints a kept-branch table** and a `💰` line with the remaining
  count and billable cost:

  ```
  📋 Kept 9 branch(es) — nothing here is billable until the project exceeds 10:

     BRANCH                                   AGE    IDLE   KEPT BECAUSE                  PRUNES     PR
     preview/claude/epic-brattain-f21f5d      23.8h  22.8h  created 23.8h ago (under 24h) in ~0.2h   #127 merged
     …
  💰 10 branch(es) remain (including main) — 0 billable ≈ $0.00/month.
  ```

- **The `PR` column is display-only.** It comes from a best-effort
  `gh pr list`; without `gh` the column is blank and the prune is unaffected.
  Nothing from it reaches `classifyNeonBranch`, which stays blind to git — the
  whole point of v1. It is annotation for the reader, never an input to a
  decision.
- **Tests** cover the metrics: which timer eligibility waits on in each regime,
  `0` for a deleted branch, `null` for protected and running-compute branches,
  and idle falling back to age when a branch has no endpoint.
- **The daily task** (`~/.claude/scheduled-tasks/neon-branch-prune/SKILL.md`,
  outside the repo) now relays the table verbatim and flags a high branch count
  when merged-PR previews inside the 24h floor are *not* the explanation.

## Current state

10 branches, 0 billable. Nine non-`main` branches, every one held by the 24h age
floor alone — none by idleness, none by the running-compute or `protected`
guards. Three back open PRs (#136, #135, #129); the other six are previews and
dev branches for PRs #134, #133, #128 and #127, all merged, all pruning within
~16h. `preview/claude/epic-brattain-f21f5d` was 0.2h from eligibility at the
time of the run.

So the count is churn, not accumulation: each PR deploy mints a preview branch,
a day's work makes several, and they now expire on their own. The steady state
Ken should expect is roughly "active work + whatever merged in the last day".
