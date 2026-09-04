# Neon stale-branch pruner: three classifier defects — v1

Branch: `claude/reverent-kalam-61e726` · 2026-09-03

## Context

The 2026-09-03 scheduled prune deleted 4 Neon branches and kept 8 it should
have deleted (5 with merged PRs whose origin refs GitHub removed on merge, plus
both `distracted-germain` branches), and deleted
`claude-pr-72-review-merge-5e13c1` while its worktree was still checked out.

PR #112 (`af20d5d`, merged 2026-09-03 22:45 ET, after that run) already added
the local-ref/merged fallback and the worktree set for the plain-name path. What
remained on `main`:

1. `branch.name.includes('main')` — substring match hid ger·**main** from all output.
2. Worktree protection did not cover the `preview/<git-branch>` form.
3. Header comment, `.sh` wrapper comment, and `branch-db.ts` / `deploy-pr-preview.md`
   described rules the code did not implement.
4. No unit coverage — the classifier was inlined in the I/O loop.

## Plan

- Extract the decision into `scripts/lib/neon-branch-classifier.ts` as a pure
  `classifyNeonBranch(branch, gitState)` returning `skip | keep | delete` with a
  reason string. Precedence: primary (exact) → worktree/current (both forms) →
  preview rules → plain rules (origin merged; origin gone + local merged; origin
  gone + finished PR; else keep).
- `cleanup-neon-branches.ts` gathers git facts (unchanged commands; fetch failure
  still aborts before any deletion) and logs each verdict.
- `scripts/test-neon-branch-cleanup.ts` in the `check()` convention, wired into
  `npm run mcp:lint` so it runs on every build.
- Rewrite the stale comments to match the classifier.
- Verify with `bash scripts/cleanup-neon-branches.sh --dry-run`; never run the
  destructive form in this branch.
