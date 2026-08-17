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
# Safety properties live in cleanup-neon-branches.ts: never deletes
# main/primary, deletes only Neon branches with no matching remote git
# branch, and deletes nothing at all when git refs can't be fetched.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -d "$HOME/local/node22/bin" ]; then
  export PATH="$HOME/local/node22/bin:$PATH"
fi

exec npx tsx scripts/cleanup-neon-branches.ts "$@"
