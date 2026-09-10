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
# by scripts/test-neon-branch-cleanup.ts). Delete a branch whose compute has
# been idle more than 6h, once EITHER it is older than 24h OR the PR for its git
# branch is merged. Git state can only bring deletion forward, never hold it off
# — if the PR lookup fails the 24h clock still applies.
# Never touched: the primary branch or one named exactly `main`, a branch Neon
# reports as `protected`, and any branch whose compute is running right now.
# Aborts before deleting anything if the compute endpoints can't be read (that
# would make every branch look idle). Pass --dry-run to print the plan without
# deleting.
#
# Leftover git worktrees no longer keep database branches alive — that coupling
# is gone. `npm run worktrees:report` lists finished worktree directories; it
# only reports, and removing them is a separate, manual decision.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -d "$HOME/local/node22/bin" ]; then
  export PATH="$HOME/local/node22/bin:$PATH"
fi

exec npx tsx scripts/cleanup-neon-branches.ts "$@"
