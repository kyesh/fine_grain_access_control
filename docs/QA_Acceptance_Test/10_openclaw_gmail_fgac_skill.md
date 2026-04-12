# QA Acceptance Test: OpenClaw gmail-fgac Skill (End-to-End)

## Prerequisites
- Node.js installed (v18+).
- The `gmail-fgac` skill installed at `docs/skills/gmail-fgac/` with `npm install` run in the `scripts/` directory.

### Testing Modes

This test supports **two modes**. Tests 1, 9, 10, and 11 run in both modes. Tests 2-8 require a valid token.

| Mode | Token Location | What It Validates |
|------|---------------|-------------------|
| **Local Dev (OAuth)** | `~/.openclaw/gmail-fgac/tokens/<label>.json` (OAuth2 token) | Skill code, argument validation, JSON contracts, Gmail API integration via direct Google connection |
| **Production (Proxy)** | `~/.openclaw/gmail-fgac/tokens/<label>.json` (Service Account with `sk_proxy_` key) | Full FGAC.AI proxy auth chain, access control rules, `rootUrl` routing |

**Local Dev Setup** (if no proxy key available):
```bash
# Copy an existing OAuth token from the old skill
cp ~/.openclaw/google-workspace-byok/tokens/<name>.json \
   ~/.openclaw/gmail-fgac/tokens/<label>.json
```

**Production Setup** (full proxy test):
1. Create a proxy key via the FGAC.AI dashboard
2. Save as a Service Account JSON token:
   ```bash
   mkdir -p ~/.openclaw/gmail-fgac/tokens
   cat > ~/.openclaw/gmail-fgac/tokens/<label>.json << EOF
   {
     "type": "service_account",
     "private_key_id": "sk_proxy_YOUR_KEY_HERE",
     "client_email": "fgac-proxy@fgac.ai",
     "token_uri": "https://fgac.ai/api/auth/token"
   }
   EOF
   ```

## Dependencies
- Must pass `01_signup_and_credential_workflow.md` first to ensure credentials exist.
- Must pass `09_universe_domain_rollback.md` to ensure the skill uses the correct `api_endpoint` pattern.

## Context
This test validates the gmail-fgac skill that is distributed to OpenClaw users. It is the **primary repeatable regression test** for the skill and should be run after any changes to:
- `docs/skills/gmail-fgac/scripts/*.js` (skill code)
- `src/app/api/proxy/[...path]/route.ts` (proxy backend)
- `src/app/api/auth/token/route.ts` (token exchange)
- `src/db/schema.ts` (access control schema)

> **Run this test after every skill modification to catch regressions.** At minimum, run the **Local Dev Smoke Test** (below) to validate skill code correctness. Run the full production tests before any release.

---

## Test Cases

### 1. Skill Installation & Dependency Check
**Objective**: Validate that the skill can be installed and its dependencies resolved without errors.

**Steps (Command Line)**:
1. Verify the skill structure:
   ```bash
   test -f docs/skills/gmail-fgac/SKILL.md && echo "SKILL.md OK" || echo "MISSING"
   test -f docs/skills/gmail-fgac/scripts/gmail.js && echo "gmail.js OK" || echo "MISSING"
   test -f docs/skills/gmail-fgac/scripts/shared.js && echo "shared.js OK" || echo "MISSING"
   test -f docs/skills/gmail-fgac/scripts/package.json && echo "package.json OK" || echo "MISSING"
   ```
2. Install dependencies:
   ```bash
   cd docs/skills/gmail-fgac/scripts && npm install
   ```
3. Verify no `universe_domain` references in active code paths:
   ```bash
   grep -rn "universe_domain" docs/skills/gmail-fgac/scripts/*.js | grep -v "// " | grep -v "DEPRECATED"
   # Must return 0 active references
   ```
4. Verify the skill uses `api_endpoint` / `rootUrl` pattern:
   ```bash
   grep -n "api/proxy\|rootUrl\|api_endpoint" docs/skills/gmail-fgac/scripts/gmail.js
   # Must return at least 1 match
   ```

**Expected Outcome**: All files present. Dependencies install cleanly. Skill code uses explicit endpoint override, not `universe_domain`.

---

### 2. Labels — Basic Connectivity
**Objective**: Validate the simplest API call works through the proxy. This is the "smoke test" for the full auth + proxy chain.

**Steps (Command Line)**:
```bash
node docs/skills/gmail-fgac/scripts/gmail.js \
  --account <label> \
  --action labels
```

**Validation**:
1. Command exits with code 0 (no error).
2. Output is valid JSON.
3. Output contains standard Gmail labels (INBOX, SENT, DRAFT, TRASH, SPAM).
4. No `401`, `403`, or `invalid_grant` errors in output.

**Expected Outcome**: The skill connects to Gmail through the FGAC.AI proxy and returns a list of labels. This confirms: authentication works, endpoint routing works, proxy forwards to Google successfully.

---

### 3. List — Recent Emails
**Objective**: Validate that the skill can list emails with search queries.

**Steps (Command Line)**:
```bash
# List 5 most recent emails
node docs/skills/gmail-fgac/scripts/gmail.js \
  --account <label> \
  --action list \
  --max 5

# List unread emails
node docs/skills/gmail-fgac/scripts/gmail.js \
  --account <label> \
  --action list \
  --query "is:unread" \
  --max 3
```

**Validation**:
1. Output is valid JSON with `count`, `messages` array.
2. Each message has: `id`, `threadId`, `from`, `to`, `subject`, `date`, `snippet`.
3. The `--query "is:unread"` filter actually narrows results (if unread emails exist).
4. The `--max` parameter limits the number of results.

**Expected Outcome**: The skill successfully lists and filters emails through the proxy.

---

### 4. Read — Message Content
**Objective**: Validate that the skill can read full message content.

**Steps (Command Line)**:
```bash
# First, get a message ID from the list action
MSG_ID=$(node docs/skills/gmail-fgac/scripts/gmail.js \
  --account <label> --action list --max 1 \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['id'])")

# Read that message
node docs/skills/gmail-fgac/scripts/gmail.js \
  --account <label> \
  --action read \
  --message-id "$MSG_ID"
```

**Validation**:
1. Output is valid JSON with `id`, `from`, `to`, `subject`, `date`, `body`.
2. The `body` field contains actual email content (not empty or `"(no readable body)"`).
3. If the email has attachments, the `attachments` array is populated with `filename`, `mimeType`, `attachmentId`.

**Expected Outcome**: The skill reads full message content through the proxy.

---

### 5. Send — Whitelisted Recipient (ALLOWED)
**Objective**: Validate that sending to a whitelisted recipient succeeds through the proxy.

> [!IMPORTANT]
> This test requires a `send_whitelist` rule configured in the FGAC.AI dashboard for the test key. The whitelisted address must be a test account you control.

**Steps (Command Line)**:
```bash
node docs/skills/gmail-fgac/scripts/gmail.js \
  --account <label> \
  --action send \
  --to "<whitelisted-email>" \
  --subject "FGAC QA Test - $(date +%s)" \
  --body "This is an automated QA test from the gmail-fgac skill. Timestamp: $(date)"
```

**Validation**:
1. Output is valid JSON with `success: true`, `id`, `threadId`.
2. The email actually arrives at the whitelisted recipient's inbox.

**Expected Outcome**: Send succeeds for whitelisted recipients.

---

### 6. Send — Blocked Recipient (DENIED)
**Objective**: Validate that sending to a non-whitelisted recipient is blocked by the FGAC.AI proxy with a clear error.

**Steps (Command Line)**:
```bash
node docs/skills/gmail-fgac/scripts/gmail.js \
  --account <label> \
  --action send \
  --to "unauthorized-target@evil-corp.com" \
  --subject "This should be blocked" \
  --body "If you see this email, the security rules failed." \
  2>&1
```

**Validation**:
1. Command exits with a non-zero code OR outputs an error JSON.
2. The error message contains `403` or `Forbidden`.
3. The error message explains WHY the send was blocked (rule name, unauthorized recipient).
4. No email is delivered to `unauthorized-target@evil-corp.com`.

**Expected Outcome**: The proxy blocks the send and returns a clear 403 error with an explanation. This is the core FGAC security feature.

---

### 7. Read — Blacklisted Content (DENIED)
**Objective**: Validate that reading emails matching a blacklist rule is blocked by the proxy.

> [!IMPORTANT]
> This test requires a `read_blacklist` rule configured in the FGAC.AI dashboard (e.g., blocking emails containing "2FA Code" or "Password Reset").

**Steps (Command Line)**:
1. First, send a test email TO the test account containing blacklisted content (from another account or use the Gmail web UI):
   - Subject: "Your 2FA Code is 123456"
   - Body: "Your verification code is 123456. Do not share this."
2. List emails and find the blacklisted message ID:
   ```bash
   node docs/skills/gmail-fgac/scripts/gmail.js \
     --account <label> --action list --query "2FA Code" --max 1
   ```
3. Attempt to read the blacklisted message:
   ```bash
   node docs/skills/gmail-fgac/scripts/gmail.js \
     --account <label> \
     --action read \
     --message-id "<id-from-step-2>" \
     2>&1
   ```

**Validation**:
1. The list action may or may not return the message (depending on whether blacklisting applies to listing vs reading).
2. The read action returns a `403 Forbidden` error.
3. The error message references the specific blacklist rule that triggered.
4. The email body content is NOT returned in any error response.

**Expected Outcome**: The proxy blocks reading of blacklisted content.

---

### 8. Forward — Through Proxy
**Objective**: Validate that forwarding works and respects send rules.

**Steps (Command Line)**:
```bash
# Get a message ID to forward
MSG_ID=$(node docs/skills/gmail-fgac/scripts/gmail.js \
  --account <label> --action list --max 1 \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['id'])")

# Forward to whitelisted recipient
node docs/skills/gmail-fgac/scripts/gmail.js \
  --account <label> \
  --action forward \
  --message-id "$MSG_ID" \
  --to "<whitelisted-email>"
```

**Validation**:
1. Output is valid JSON with `success: true`, `action: "forward"`, `originalSubject`, `originalFrom`.
2. The forwarded email arrives at the recipient with proper "Fwd:" subject prefix.

```bash
# Forward to blocked recipient — should fail
node docs/skills/gmail-fgac/scripts/gmail.js \
  --account <label> \
  --action forward \
  --message-id "$MSG_ID" \
  --to "unauthorized-target@evil-corp.com" \
  2>&1
```

**Validation**:
1. Returns `403 Forbidden` — same rules as send apply to forward.

**Expected Outcome**: Forward respects the same send whitelist rules as direct send.

---

### 9. Error Handling — Invalid Account
**Objective**: Validate the skill fails gracefully with a helpful error when given invalid credentials.

**Steps (Command Line)**:
```bash
# Non-existent account label
node docs/skills/gmail-fgac/scripts/gmail.js \
  --account nonexistent \
  --action labels \
  2>&1
```

**Validation**:
1. Command exits with a non-zero code.
2. Error message clearly states the credential/token file was not found.
3. Error message suggests the correct token path (e.g., `tokens/nonexistent.json`).

**Expected Outcome**: Clear, actionable error message — not a cryptic stack trace.

---

### 10. Error Handling — Missing Arguments
**Objective**: Validate argument validation for actions that require parameters.

**Steps (Command Line)**:
```bash
# Read without message-id
node docs/skills/gmail-fgac/scripts/gmail.js \
  --account <label> --action read 2>&1
# Expected: "--message-id is required for read"

# Send without --to
node docs/skills/gmail-fgac/scripts/gmail.js \
  --account <label> --action send --subject "Test" 2>&1
# Expected: "--to is required for send"

# Forward without --message-id
node docs/skills/gmail-fgac/scripts/gmail.js \
  --account <label> --action forward --to test@test.com 2>&1
# Expected: "--message-id is required for forward"

# No --account at all
node docs/skills/gmail-fgac/scripts/gmail.js --action labels 2>&1
# Expected: Usage message
```

**Validation**:
1. Each case exits with non-zero code.
2. Each case prints a clear, specific error message (not a crash or stack trace).

**Expected Outcome**: All argument validation errors produce user-friendly messages.

---

### 11. JSON Output Contract
**Objective**: Validate that all actions produce well-structured JSON that OpenClaw agents can reliably parse.

**Steps (Command Line)**:
```bash
# Validate each action's output is valid JSON
for action in labels list; do
  echo "--- Testing $action ---"
  node docs/skills/gmail-fgac/scripts/gmail.js \
    --account <label> --action $action --max 2 \
    | python3 -c "import json,sys; json.load(sys.stdin); print('VALID JSON')" \
    || echo "INVALID JSON for $action"
done
```

**Validation**:
1. All successful actions output valid, parseable JSON.
2. No actions mix JSON output with non-JSON error text on stdout (errors should go to stderr).
3. The JSON structure is stable — agents depend on field names like `messages`, `count`, `id`, `body`, `success`.

**Expected Outcome**: All outputs are valid JSON. Errors go to stderr, data to stdout.

---

## Local Dev Smoke Test (Minimum Required)

Run this after any skill code change. Requires only an OAuth token (no proxy key needed).

```bash
cd docs/skills/gmail-fgac/scripts

LABEL=ken  # Replace with your OAuth token label

echo "=== 1. Argument validation ==="
node gmail.js --action labels 2>&1 | grep -q "Usage:" && echo "PASS: no --account" || echo "FAIL"
node gmail.js --account $LABEL --action read 2>&1 | grep -q "message-id is required" && echo "PASS: read without --message-id" || echo "FAIL"
node gmail.js --account $LABEL --action send --subject "x" 2>&1 | grep -q "to is required" && echo "PASS: send without --to" || echo "FAIL"
node gmail.js --account $LABEL --action forward --to x@x.com 2>&1 | grep -q "message-id is required" && echo "PASS: forward without --message-id" || echo "FAIL"
node gmail.js --account $LABEL --action bogus 2>&1 | grep -q "Unknown action" && echo "PASS: invalid action" || echo "FAIL"
node gmail.js --account nonexistent --action labels 2>&1 | grep -q "No token found" && echo "PASS: invalid account" || echo "FAIL"

echo ""
echo "=== 2. Labels (smoke test — auth + Gmail API) ==="
node gmail.js --account $LABEL --action labels \
  | python3 -c "import json,sys; d=json.load(sys.stdin); names=[l['name'] for l in d['labels']]; print(f'Labels: {d[\"count\"]}  INBOX:{\"INBOX\" in names}  SENT:{\"SENT\" in names}'); sys.exit(0 if d['count']>0 else 1)"

echo ""
echo "=== 3. List (data flow) ==="
node gmail.js --account $LABEL --action list --max 2 \
  | python3 -c "import json,sys; d=json.load(sys.stdin); m=d['messages'][0]; print(f'Messages: {d[\"count\"]}  Has id/subject/from: {bool(m.get(\"id\"))}/{bool(m.get(\"subject\"))}/{bool(m.get(\"from\"))}'); sys.exit(0 if d['count']>0 else 1)"

echo ""
echo "=== 4. Read (full message) ==="
MSG_ID=$(node gmail.js --account $LABEL --action list --max 1 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['id'])")
node gmail.js --account $LABEL --action read --message-id "$MSG_ID" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Subject: {d[\"subject\"][:60]}'); print(f'Body len: {len(d.get(\"body\",\"\"))}'); sys.exit(0 if d.get('body') else 1)"

echo ""
echo "=== 5. JSON output contract ==="
for action in labels list; do
  node gmail.js --account $LABEL --action $action --max 2 2>/dev/null \
    | python3 -c "import json,sys; json.load(sys.stdin); print(f'  {\"$action\"}: VALID JSON')" \
    || echo "  $action: INVALID JSON"
done

echo ""
echo "--- Local dev smoke test complete ---"
```

---

## Production Smoke Test (Full FGAC Proxy)

Run this before releases. Requires a `sk_proxy_...` key saved as a Service Account token (see Prerequisites above).

```bash
cd docs/skills/gmail-fgac/scripts

LABEL=qa-test  # Replace with your Service Account token label

# 1. Labels (smoke test — auth + proxy + Gmail API)
node gmail.js --account $LABEL --action labels \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Labels: {d[\"count\"]}'); exit(0 if d['count'] > 0 else 1)"

# 2. List (data flow through proxy)
node gmail.js --account $LABEL --action list --max 2 \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Messages: {d[\"count\"]}'); exit(0 if d['count'] >= 0 else 1)"

# 3. Read (full message through proxy)
MSG_ID=$(node gmail.js --account $LABEL --action list --max 1 | python3 -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['id'])")
node gmail.js --account $LABEL --action read --message-id "$MSG_ID" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Subject: {d[\"subject\"]}'); exit(0 if d.get('body') else 1)"

# 4. Blocked send (security — requires send rules configured)
node gmail.js --account $LABEL --action send --to "blocked@evil.com" --subject "blocked" --body "test" 2>&1 \
  | grep -q "403\|Forbidden" && echo "BLOCKED OK" || echo "SECURITY FAILURE"

echo "--- Production smoke test complete ---"
```

