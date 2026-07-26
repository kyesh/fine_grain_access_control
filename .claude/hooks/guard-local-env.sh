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

# ── Killing Chrome (Session Hygiene rule 8) ────────────────────────────────
# `pkill chrome` kills the user's REAL browser. Only the scoped form that
# targets the gitignored test profile is safe.
# Blocked:  pkill chrome / pkill -f chrome / killall chrome / killall "Google Chrome"
# Allowed:  pkill -f 'chrome.*playwright_user_data'
# Anchored to a command position — prose mentioning pkill (commit messages,
# PR bodies) is not a command.
if printf '%s' "$CMD" | grep -qiE '(^|[;&|(][[:space:]]*|sudo[[:space:]]+)(pkill|killall)[[:space:]][^|;&]*chrome'; then
  if ! printf '%s' "$CMD" | grep -q 'playwright_user_data'; then
    block "BLOCKED: this would kill the user's real Chrome.
To clean up only test browsers, scope to the test profile:
  pkill -f 'chrome.*playwright_user_data'
See CLAUDE.md → Session Hygiene rule 8."
  fi
fi

# ── Production env pulls to auto-loaded files ──────────────────────────────
# .env.production.local is auto-loaded by Next.js when NODE_ENV=production,
# and .env.local is development-only. Production credentials belong ONLY in
# .secrets/prod.env (gitignored, never auto-loaded).
# Blocked:  vercel env pull .env.production.local
#           vercel env pull .env.local --environment=production
# Allowed:  vercel env pull .secrets/prod.env --environment=production
#           vercel env pull .env.local --environment=development
#           git commit -m "... vercel env pulls ..."   (prose mentioning the
#           command is not the command — anchor to a command position)
if printf '%s' "$CMD" | grep -qiE '(^|[;&|(][[:space:]]*|npx[[:space:]]+)vercel[[:space:]]+env[[:space:]]+pull[[:space:]]'; then
  if printf '%s' "$CMD" | grep -qE '\.env\.production(\.local)?([[:space:]]|$)'; then
    block "BLOCKED: .env.production.local is auto-loaded by Next.js when NODE_ENV=production.
Pull production credentials only to .secrets/prod.env:
  npx vercel env pull .secrets/prod.env --environment=production
See CLAUDE.md → 'Production Credentials on a Local Machine'."
  fi
  if printf '%s' "$CMD" | grep -qiE '\.env\.local\b' \
     && printf '%s' "$CMD" | grep -qiE '(--environment[= ]|-e[[:space:]]+)production'; then
    block "BLOCKED: .env.local is development-only — never put production credentials in it.
Pull production credentials only to .secrets/prod.env:
  npx vercel env pull .secrets/prod.env --environment=production
See CLAUDE.md → 'Production Credentials on a Local Machine'."
  fi
fi

# ── Production deploys (defence in depth alongside the deny rules) ─────────
# Only deploy-shaped commands. `vercel ls --prod`, `inspect`, and `logs --prod`
# are read-only and explicitly listed as safe in CLAUDE.md — an earlier version
# of this pattern matched any `vercel` + `--prod` and blocked those too.
if printf '%s' "$CMD" | grep -qiE 'vercel[[:space:]]+(promote|alias)\b'; then
  block "BLOCKED: promote/alias change what production serves — user's call via /deploy-prod (CLAUDE.md)."
fi
if printf '%s' "$CMD" | grep -qiE 'vercel([[:space:]]+deploy)?([[:space:]]+-[^[:space:]]+)*[[:space:]]+--prod\b' \
   && ! printf '%s' "$CMD" | grep -qiE 'vercel[[:space:]]+(ls|list|inspect|logs|env|projects?)\b'; then
  block "BLOCKED: production deploys are the user's call via /deploy-prod (CLAUDE.md)."
fi

exit 0
