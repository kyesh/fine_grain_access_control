#!/bin/bash
# Stop hook: end-of-turn hygiene checks (CLAUDE.md Session Hygiene 5/7,
# Database Rule 8, QA coverage).
#
# Checks, in order:
#   1. Binary files (png/pdf) sitting in the repo root         — Hygiene 5
#   2. Untracked-file count over 20                            — Hygiene 7
#   3. schema.ts changed on this branch but no new migration   — DB Rule 8
#   4. A fresh qa-results.json that fails the coverage check   — QA
#
# Exit 2 feeds the findings back to the agent so it can clean up before
# ending the turn. The stop_hook_active flag prevents loops: when the agent
# is already continuing because of this hook, we stay silent.

set -uo pipefail

INPUT=$(cat)
ACTIVE=$(printf '%s' "$INPUT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("stop_hook_active",False))' 2>/dev/null || echo "False")
[ "$ACTIVE" = "True" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

ISSUES=""

# 1. Binaries in the repo root (tracked or not).
ROOT_BINARIES=$(find . -maxdepth 1 \( -name '*.png' -o -name '*.pdf' -o -name '*.jpg' -o -name '*.jpeg' \) 2>/dev/null | sed 's|^\./||')
if [ -n "$ROOT_BINARIES" ]; then
  ISSUES="$ISSUES
- Binary files in the repo root (Session Hygiene 5 — move to a gitignored dir like .playwright/ or delete): $(echo "$ROOT_BINARIES" | tr '\n' ' ')"
fi

# 2. Untracked-file count.
UNTRACKED=$(git status --short 2>/dev/null | grep -c '^??' || true)
if [ "${UNTRACKED:-0}" -gt 20 ]; then
  ISSUES="$ISSUES
- $UNTRACKED untracked files (Session Hygiene 7 says keep this under 20 — commit, gitignore, or delete)"
fi

# 3. Schema changed on this branch with no migration to match.
if git diff --name-only origin/main...HEAD 2>/dev/null | grep -q '^src/db/schema.ts$'; then
  if ! git diff --name-only origin/main...HEAD 2>/dev/null | grep -q '^src/db/migrations/.*\.sql$'; then
    ISSUES="$ISSUES
- src/db/schema.ts changed on this branch but no migration was added under src/db/migrations/ (Database Rules 4/8: npm run db:generate, then db:push)"
  fi
fi

# 4. Coverage check on a fresh QA results file (touched in the last 6 hours).
QA_RESULTS="docs/QA_Acceptance_Test/qa-results.json"
if [ -f "$QA_RESULTS" ] && [ -n "$(find "$QA_RESULTS" -mmin -360 2>/dev/null)" ]; then
  NODE22="$HOME/local/node22/bin"
  [ -d "$NODE22" ] && export PATH="$NODE22:$PATH"
  COVERAGE=$(npx tsx scripts/qa-coverage-check.ts 2>&1)
  if [ $? -ne 0 ]; then
    ISSUES="$ISSUES
- QA coverage check failed for the current qa-results.json:
$COVERAGE"
  fi
fi

if [ -n "$ISSUES" ]; then
  echo "End-of-turn hygiene check found issues:$ISSUES

Address these (or explain to the user why they are intentional) before finishing." >&2
  exit 2
fi

exit 0
