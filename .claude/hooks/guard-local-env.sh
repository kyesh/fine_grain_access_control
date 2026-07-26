#!/bin/bash
# PreToolUse guard for Bash commands.
#
# Exists because an agent session improvised a local Postgres in Docker and let
# Clerk run in keyless mode, instead of using the documented bootstrap
# (`vercel env pull` + `npm run db:branch`). Both are cheap mistakes to make and
# expensive to notice — the app "works", it is just not testing the real stack.
#
# Exit 0 = allow. Exit 2 = block, stderr is fed back to the agent.

set -uo pipefail

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null || echo "")

[ -z "$CMD" ] && exit 0

block() {
  echo "$1" >&2
  exit 2
}

# ── Improvised database ────────────────────────────────────────────────────
# Any attempt to stand up a local Postgres/MySQL rather than use a Neon branch.
if printf '%s' "$CMD" | grep -qiE 'docker (run|compose up).*(postgres|pgvector|mysql|mariadb)'; then
  block "BLOCKED: do not stand up a local database container.
This project uses isolated Neon branches. Run:
  npm run db:branch
See CLAUDE.md → 'Local Development Environment' and Database Rules 1-2."
fi

# ── Schema push without branch isolation ───────────────────────────────────
# db:branch writes neon__POSTGRES_URL into .env.local; absence means the
# isolated branch was never provisioned for this git branch.
if printf '%s' "$CMD" | grep -qiE 'drizzle-kit (push|migrate)|npm run db:(push|migrate)'; then
  if [ ! -f .env.local ] || ! grep -q '^neon__POSTGRES_URL=' .env.local 2>/dev/null; then
    block "BLOCKED: no isolated Neon branch for this git branch.
Run 'npm run db:branch' first (CLAUDE.md Database Rule 1). Pushing schema
without it risks executing against a shared or production branch."
  fi
fi

# ── Hand-authored env files ────────────────────────────────────────────────
# .env.local must come from `vercel env pull` + `npm run db:branch`, never from
# values an agent invented.
if printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])(cat|echo|printf|tee)[^;&|]*>[>]?[[:space:]]*\.?\/?\.env'; then
  block "BLOCKED: do not hand-write .env files.
Use 'npx vercel env pull .env.local --environment=development' then
'npm run db:branch'. See CLAUDE.md → 'Local Development Environment'."
fi

# ── Production deploys (defence in depth alongside the deny rules) ─────────
if printf '%s' "$CMD" | grep -qiE 'vercel.*(--prod|promote|alias)'; then
  block "BLOCKED: production deploys are the user's call via /deploy-prod (CLAUDE.md)."
fi

exit 0
