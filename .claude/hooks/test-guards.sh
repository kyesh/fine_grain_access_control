#!/bin/bash
# Test harness for the PreToolUse guards. Run from the repo root:
#   bash .claude/hooks/test-guards.sh
#
# Every guard ships with positive (must BLOCK) and negative (must ALLOW)
# cases — the fix/vercel-guard-readonly lesson: an over-broad guard that
# blocks legitimate workflow steps is a bug, caught here before it ships.

set -uo pipefail
HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0 FAIL=0

check() { # check <hook> <BLOCK|ALLOW> <description> <command>
  local hook="$1" want="$2" desc="$3" cmd="$4"
  local json
  json=$(python3 -c 'import json,sys; print(json.dumps({"tool_input":{"command":sys.argv[1]}}))' "$cmd")
  printf '%s' "$json" | "$HOOKS_DIR/$hook" >/dev/null 2>&1
  local status=$?
  local got="ALLOW"; [ $status -eq 2 ] && got="BLOCK"
  if [ "$got" = "$want" ]; then
    PASS=$((PASS+1)); echo "  ok   [$want] $desc"
  else
    FAIL=$((FAIL+1)); echo "  FAIL [want $want, got $got] $desc: $cmd"
  fi
}

G=guard-local-env.sh

echo "── improvised database ──────────────────────────────────────────"
check $G BLOCK "docker postgres"          "docker run -d -p 5432:5432 postgres:16"
check $G ALLOW "docker for openclaw QA"   "docker run --rm openclaw/openclaw:latest"

echo "── schema push without branch ───────────────────────────────────"
# (branch-dependent: only shape-checked here; .env.local state drives outcome)

echo "── hand-written env files ───────────────────────────────────────"
check $G BLOCK "echo into .env.local"     "echo 'POSTGRES_URL=x' > .env.local"
check $G ALLOW "reading .env.local"       "grep neon__ .env.local"

echo "── pkill chrome (Session Hygiene 8) ─────────────────────────────"
check $G BLOCK "bare pkill chrome"        "pkill chrome"
check $G BLOCK "pkill -f chrome"          "pkill -f chrome"
check $G BLOCK "killall chrome"           "killall 'Google Chrome'"
check $G ALLOW "scoped to test profile"   "pkill -f 'chrome.*playwright_user_data'"
check $G ALLOW "unrelated pkill"          "pkill -f 'next dev'"
check $G ALLOW "prose mentioning pkill"   "gh pr create --body 'adds pkill-chrome and prod-env-pull guards'"
check $G BLOCK "pkill after && chain"     "sleep 1 && pkill -f chrome"

echo "── production env pulls ─────────────────────────────────────────"
check $G BLOCK "pull to .env.production.local"   "npx vercel env pull .env.production.local --environment=production"
check $G BLOCK "prod pull into .env.local"       "npx vercel env pull .env.local --environment=production"
check $G ALLOW "prod pull to .secrets"           "npx vercel env pull .secrets/prod.env --environment=production"
check $G ALLOW "dev pull to .env.local"          "npx vercel env pull .env.local --environment=development"
check $G ALLOW "commit msg mentioning the cmd"   "git commit -m 'block vercel env pulls that put prod creds in .env.local via --environment=production'"
check $G BLOCK "bare vercel at cmd start"        "vercel env pull .env.local --environment=production"
check $G BLOCK "after && chain"                  "cd app && npx vercel env pull .env.production.local"

echo "── production deploys ───────────────────────────────────────────"
check $G BLOCK "vercel --prod deploy"     "npx vercel --prod"
check $G BLOCK "vercel deploy --prod"     "npx vercel deploy --prod --yes"
check $G BLOCK "vercel promote"           "npx vercel promote https://x.vercel.app"
check $G BLOCK "vercel alias"             "npx vercel alias set x.vercel.app fgac.ai"
check $G ALLOW "vercel ls --prod"         "npx vercel ls googleapis-fine-grain-access-control --prod"
check $G ALLOW "vercel logs --prod"       "npx vercel logs googleapis-fine-grain-access-control --prod"
check $G ALLOW "vercel inspect"           "npx vercel inspect https://x.vercel.app"
check $G ALLOW "vercel env pull dev"      "npx vercel env pull .env.local --environment=development"

echo
echo "$PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
