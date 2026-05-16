#!/bin/bash
# TestClaw QA Runner — Automated FGAC skill tests
# Run inside the TestClaw container

set -euo pipefail

FGAC_URL="${FGAC_ROOT_URL:-http://localhost:3000}"
PASS=0
FAIL=0
TOTAL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() { ((PASS++)) || true; ((TOTAL++)) || true; echo -e "${GREEN}✅ PASS${NC}: $1"; }
log_fail() { ((FAIL++)) || true; ((TOTAL++)) || true; echo -e "${RED}❌ FAIL${NC}: $1"; }
log_info() { echo -e "${YELLOW}ℹ️  ${NC}$1"; }

# ─── Test 1: Discovery Endpoints ────────────────────────────────────────────

log_info "Test 1: OAuth discovery endpoints"

OAUTH_META=$(curl -sf "${FGAC_URL}/.well-known/oauth-authorization-server" 2>/dev/null || echo "FAIL")
if echo "$OAUTH_META" | jq -e '.authorization_endpoint' >/dev/null 2>&1; then
  log_pass "OAuth authorization server metadata"
else
  log_fail "OAuth authorization server metadata"
fi

RESOURCE_META=$(curl -sf "${FGAC_URL}/.well-known/oauth-protected-resource/mcp" 2>/dev/null || echo "FAIL")
if echo "$RESOURCE_META" | jq -e '.resource' >/dev/null 2>&1; then
  log_pass "OAuth protected resource metadata"
else
  log_fail "OAuth protected resource metadata"
fi

# ─── Test 2: Unauthenticated Request → 401 ──────────────────────────────────

log_info "Test 2: Unauthenticated MCP request → 401"

HTTP_CODE=$(curl -so /dev/null -w '%{http_code}' \
  -X POST "${FGAC_URL}/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}')

if [ "$HTTP_CODE" = "401" ]; then
  log_pass "Unauthenticated request returns 401"
else
  log_fail "Expected 401, got $HTTP_CODE"
fi

# ─── Test 3: Proxy Key Auth (via Bearer token) ──────────────────────────────

CRED_FILE="/home/node/.openclaw/gmail-fgac/fgac-credentials.json"
if [ -f "$CRED_FILE" ]; then
  PROXY_KEY=$(jq -r '.proxy_key // empty' "$CRED_FILE")
  if [ -n "$PROXY_KEY" ]; then
    log_info "Test 3: Proxy key auth via gmail.js"

    # Test gmail.js list with the saved credentials
    GMAIL_OUTPUT=$(FGAC_ROOT_URL="$FGAC_URL" node /home/node/.openclaw/skills/gmail-fgac/scripts/gmail.js --action list 2>&1 || echo "FAIL")

    if echo "$GMAIL_OUTPUT" | grep -q '"messages"'; then
      log_pass "gmail.js --action list returns messages"
    elif echo "$GMAIL_OUTPUT" | grep -q '"query"'; then
      log_pass "gmail.js --action list returns query results (empty inbox)"
    else
      log_fail "gmail.js --action list failed: $GMAIL_OUTPUT"
    fi
  else
    log_info "Test 3: SKIP — no proxy key in credentials"
  fi
else
  log_info "Test 3: SKIP — no credentials file"
fi

# ─── Test 4: Auth Script Status Check ────────────────────────────────────────

if [ -f "$CRED_FILE" ]; then
  log_info "Test 4: auth.js --action status"

  AUTH_STATUS=$(FGAC_ROOT_URL="$FGAC_URL" node /home/node/.openclaw/skills/gmail-fgac/scripts/auth.js --action status 2>&1 || echo "FAIL")

  if echo "$AUTH_STATUS" | grep -qi "approved\|Connection approved"; then
    log_pass "auth.js --action status shows approved"
  elif echo "$AUTH_STATUS" | grep -qi "pending"; then
    log_pass "auth.js --action status shows pending (expected for new setup)"
  else
    log_fail "auth.js --action status unexpected: $AUTH_STATUS"
  fi
else
  log_info "Test 4: SKIP — no credentials file"
fi

# ─── Summary ────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo -e " TestClaw QA Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC} / ${TOTAL} total"
echo "═══════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
