# Neon branch pruning — revision 3: merged PRs skip the 24h wait

**Branch:** `claude/adoring-keller-6c98ea` · **Date:** 2026-09-10 · Supersedes v2

v1 established the time policy; v2 added the kept-branch table. This revision
adds the second delete trigger Ken asked for.

## Rule

Delete when **compute has been idle more than 6h** AND **either** the branch is
older than 24h **or** the PR for its git branch is merged.

```
idle > 6h ─┬─ PR merged        → delete
           └─ age > 24h        → delete
idle ≤ 6h                      → keep (always)
```

Guards unchanged: primary/`main`, `protected` in Neon, and running compute win
over everything, merged PRs included.

## The invariant this had to preserve

v1 removed git from the classifier because a git fact — "checked out in a
worktree" — was being used as a **keep**, which let a leftover directory pin a
database branch forever. Bringing git back risks reintroducing exactly that.

So the rule is directional, and it is asserted in the tests:

> **Git state may only ACCELERATE deletion, never prevent it.**

A merged PR can bring deletion forward. Nothing about git can push it back.
The failure mode follows from this: when the `gh` lookup fails, the merged-ref
map is empty, the merged path goes dormant, and every branch falls back to the
24h clock. The run prints `ℹ️  gh unavailable — merged-PR pruning is off this
run; the 24h clock still applies.` Less prompt, never wrong.

Two details that matter for correctness:

- **Only the newest PR per head ref counts.** A reused branch name whose latest
  PR is open is live work, whatever older merged PRs share the name.
- **Both Neon shapes map back to the git ref**: `preview/<git-branch>` strips
  the prefix, and the local `db:branch` form goes through `sanitize()`, which
  returns for this purpose only. So merging a PR retires both of its branches.

## Why the 6h idle floor still applies on the merged path

Merging proves the work is done, not that every session has let go of the
branch. Neon suspends compute after a few minutes, so `current_state ===
'active'` alone would miss a live session that is merely between queries. The
idle floor is what makes "delete on merge" safe to run unattended; without it a
merge during an active QA pass would pull the database out from under it.

The practical consequence, now documented in CLAUDE.md: **finish QA against a
branch before merging, not after.**

## Changes

- `classifyNeonBranch(branch, endpoints, now, merged)` — new fourth argument,
  a `MergedRefs` map of head ref to PR label. Defaults to empty, so every
  existing call site keeps the pure time behaviour.
- `sanitize()` re-exported for the local-dev name mapping.
- Runner reads PR state once and uses it twice: merged refs as a delete input,
  and the same data as the display-only `PR` column in the kept table.
- Tests: the merged path in both branch shapes, the idle floor guarding it, the
  three guards beating it, and — the important ones — that an empty merged map
  reproduces v1's behaviour exactly in both directions.

## Result

Dry run: **5 deletions, 5 kept, 6 branches remain** (was 10). The five deletions
are all merged-PR branches that would otherwise have waited out the 24h clock
(#134, #133, #128 ×2, #127). What is left matches the "3–5 active" expectation:
this PR's preview, a probe branch, the just-merged #136 still inside its 6h idle
window, and #129's pair (open work, under 24h).
