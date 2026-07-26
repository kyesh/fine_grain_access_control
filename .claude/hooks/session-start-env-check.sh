#!/bin/bash
# SessionStart hook: answer "am I pointed at prod?" before the first command.
#
# Runs `npm run env:check` (resolved DB host, Clerk key mode, consistency)
# and surfaces the result as session context. Tolerant by design: a missing
# .env.local or a slow/failed check must never block a session from starting.
#
# stdout is added to the session's context. Always exit 0.

set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

if [ ! -f .env.local ]; then
  echo "[env-check] No .env.local — local env not bootstrapped. Before running the app:
  npx vercel env pull .env.local --environment=development && npm run db:branch
(See CLAUDE.md → Local Development Environment.)"
  exit 0
fi

# Node 22 requirement (system Node may be v16). Prefer the known install.
NODE22="$HOME/local/node22/bin"
if [ -d "$NODE22" ]; then
  export PATH="$NODE22:$PATH"
fi

# No shell-level timeout on stock macOS; the hook's own timeout (settings.json)
# bounds this instead.
OUT=$(npm run env:check --silent 2>&1)
STATUS=$?

if [ $STATUS -eq 0 ]; then
  echo "[env-check at session start]"
  echo "$OUT"
else
  echo "[env-check] Could not verify the environment (exit $STATUS). Run 'npm run env:check'
manually before touching the database. Output was:"
  echo "$OUT" | tail -5
fi

exit 0
