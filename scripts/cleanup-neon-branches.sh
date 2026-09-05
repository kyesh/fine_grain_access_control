#!/usr/bin/env bash
# Agent-safe entry point for the Neon stale-branch cleanup.
#
# Exists so the allowlisted invocation is ONE literal command with no
# environment prefix: permission rules are prefix matches, so
# `export PATH=... && npx tsx scripts/cleanup-neon-branches.ts` does NOT
# match a rule for the bare npx command — the classic way an agent ends up
# classifier-blocked despite the script being allowlisted. This wrapper
# resolves Node 22 itself (system Node may be too old for tsx).
#
# Safety properties live in scripts/lib/neon-branch-classifier.ts (unit-tested
# by scripts/test-neon-branch-cleanup.ts): never deletes the primary branch or
# a branch named exactly `main`; never deletes a branch checked out in any git
# worktree (preview/ or local-dev form); never deletes a preview branch backing
# an open PR; deletes a local-dev branch only when its git branch is proven
# merged (origin ref merged, or origin ref gone AND a local ref merged into
# origin/main, or a merged/closed PR head ref matches); keeps anything that
# maps to no git branch at all; and deletes nothing when git refs can't be
# fetched. Pass --dry-run to print the plan without deleting.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -d "$HOME/local/node22/bin" ]; then
  export PATH="$HOME/local/node22/bin:$PATH"
fi

exec npx tsx scripts/cleanup-neon-branches.ts "$@"
