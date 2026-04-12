# QA Acceptance Test: OpenClaw gmail-fgac Skill (End-to-End)

## Prerequisites
- Node.js installed (v18+).
- Local dev server running (`npm run dev` at `http://localhost:3000`).
- A user account signed in via the dashboard with Google OAuth Gmail scopes granted.
- The `gmail-fgac` skill dependencies installed: `cd docs/skills/gmail-fgac/scripts && npm install`.

## Setup: Create a Proxy Key and Token File

The skill **must** be tested through the FGAC.AI proxy. Follow these steps to create a proxy key and configure the skill to use it.

### Step 1: Create a Proxy Key via the Dashboard

1. Navigate to `http://localhost:3000/dashboard`.
2. Click **"Create New Key"**.
3. Enter a label (e.g., `QA-Test-Key`).
4. Check the email account(s) you want the key to access.
5. Click **"Create Key"**.
6. Copy the `sk_proxy_...` key from the dialog.

### Step 2: Save the Token File

The skill reads tokens from `~/.openclaw/gmail-fgac/tokens/<label>.json`. Create a Service Account token file pointing at the proxy:

```bash
mkdir -p ~/.openclaw/gmail-fgac/tokens
cat > ~/.openclaw/gmail-fgac/tokens/qa-test.json << EOF
{
  "type": "service_account",
  "private_key_id": "sk_proxy_PASTE_YOUR_KEY_HERE",
  "client_email": "fgac-proxy@fgac.ai",
  "token_uri": "https://fgac.ai/api/auth/token"
}
EOF
```

### Step 3: Set the Root URL for Local Testing

The skill defaults to production (`https://gmail.fgac.ai`). For local dev testing, override via environment variable:

```bash
export FGAC_ROOT_URL=http://localhost:3000
```

> [!IMPORTANT]
> **How root URL override works in each SDK:**
> - **Node.js `rootUrl`**: Replaces only the domain. The SDK appends `/gmail/v1/` automatically. Any path in `rootUrl` is stripped.
> - **Python `api_endpoint`**: Replaces `rootUrl + servicePath`. You must include `/gmail/v1` in the value.
>
> For local dev, the middleware rewrites `/gmail/v1/*` → `/api/proxy/gmail/v1/*` so the proxy catches all requests.
>
> All test commands below use `FGAC_ROOT_URL` (not the old `FGAC_PROXY_URL`).

## Dependencies
- Must pass `01_signup_and_credential_workflow.md` first to ensure credentials exist.
- Must pass `09_universe_domain_rollback.md` to ensure the skill uses the root URL override pattern.

## Context
This test validates the gmail-fgac skill that is distributed to OpenClaw users. It is the **primary repeatable regression test** for the skill and should be run after any changes to:
- `docs/skills/gmail-fgac/scripts/*.js` (skill code)
- `src/app/api/proxy/[...path]/route.ts` (proxy backend)
- `src/app/api/auth/token/route.ts` (token exchange)
- `src/db/schema.ts` (access control schema)

> **Run this test after every skill modification to catch regressions.**

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
4. Verify the skill uses the root URL override pattern:
   ```bash
   grep -n "FGAC_ROOT_URL\|rootUrl\|gmail\.fgac\.ai" docs/skills/gmail-fgac/scripts/gmail.js
   # Must return matches showing rootUrl override with gmail.fgac.ai default
   ```

**Expected Outcome**: All files present. Dependencies install cleanly. Skill code uses the root URL override pattern (`rootUrl` for Node.js), not `universe_domain`.

---

### 2. Labels — Basic Connectivity (Through Proxy)
**Objective**: Validate the simplest API call works through the FGAC.AI proxy. This is the "smoke test" for the full auth + proxy chain.

**Steps (Command Line)**:
```bash
FGAC_ROOT_URL=http://localhost:3000 \
  node docs/skills/gmail-fgac/scripts/gmail.js \
  --account qa-test \
  --action labels
```

**Validation**:
1. Command exits with code 0 (no error).
2. Output is valid JSON.
3. Output contains standard Gmail labels (INBOX, SENT, DRAFT, TRASH, SPAM).
4. No `401`, `403`, or `invalid_grant` errors in output.

**Expected Outcome**: The skill connects to Gmail **through the FGAC.AI proxy** and returns a list of labels. This confirms: proxy key authentication works, root URL routing works, proxy forwards to Google successfully.

---

### 3. List — Recent Emails (Through Proxy)
**Objective**: Validate that the skill can list emails through the proxy.

**Steps (Command Line)**:
```bash
FGAC_ROOT_URL=http://localhost:3000 \
  node docs/skills/gmail-fgac/scripts/gmail.js \
  --account qa-test \
  --action list \
  --max 5
```

**Validation**:
1. Output is valid JSON with `count`, `messages` array.
2. Each message has: `id`, `threadId`, `from`, `to`, `subject`, `date`, `snippet`.
3. The `--max` parameter limits the number of results.

**Expected Outcome**: The skill successfully lists emails through the proxy.

---

### 4. Read — Message Content (Through Proxy)
**Objective**: Validate that the skill can read full message content through the proxy.

**Steps (Command Line)**:
```bash
# First, get a message ID from the list action
MSG_ID=$(FGAC_ROOT_URL=http://localhost:3000 \
  node docs/skills/gmail-fgac/scripts/gmail.js \
  --account qa-test --action list --max 1 \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['id'])")

# Read that message
FGAC_ROOT_URL=http://localhost:3000 \
  node docs/skills/gmail-fgac/scripts/gmail.js \
  --account qa-test \
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
FGAC_ROOT_URL=http://localhost:3000 \
  node docs/skills/gmail-fgac/scripts/gmail.js \
  --account qa-test \
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
FGAC_ROOT_URL=http://localhost:3000 \
  node docs/skills/gmail-fgac/scripts/gmail.js \
  --account qa-test \
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
   FGAC_ROOT_URL=http://localhost:3000 \
     node docs/skills/gmail-fgac/scripts/gmail.js \
     --account qa-test --action list --query "2FA Code" --max 1
   ```
3. Attempt to read the blacklisted message:
   ```bash
   FGAC_ROOT_URL=http://localhost:3000 \
     node docs/skills/gmail-fgac/scripts/gmail.js \
     --account qa-test \
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
MSG_ID=$(FGAC_ROOT_URL=http://localhost:3000 \
  node docs/skills/gmail-fgac/scripts/gmail.js \
  --account qa-test --action list --max 1 \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['id'])")

# Forward to whitelisted recipient
FGAC_ROOT_URL=http://localhost:3000 \
  node docs/skills/gmail-fgac/scripts/gmail.js \
  --account qa-test \
  --action forward \
  --message-id "$MSG_ID" \
  --to "<whitelisted-email>"
```

**Validation**:
1. Output is valid JSON with `success: true`, `action: "forward"`, `originalSubject`, `originalFrom`.
2. The forwarded email arrives at the recipient with proper "Fwd:" subject prefix.

```bash
# Forward to blocked recipient — should fail
FGAC_ROOT_URL=http://localhost:3000 \
  node docs/skills/gmail-fgac/scripts/gmail.js \
  --account qa-test \
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
  --account qa-test --action read 2>&1
# Expected: "--message-id is required for read"

# Send without --to
node docs/skills/gmail-fgac/scripts/gmail.js \
  --account qa-test --action send --subject "Test" 2>&1
# Expected: "--to is required for send"

# Forward without --message-id
node docs/skills/gmail-fgac/scripts/gmail.js \
  --account qa-test --action forward --to test@test.com 2>&1
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
  FGAC_ROOT_URL=http://localhost:3000 \
    node docs/skills/gmail-fgac/scripts/gmail.js \
    --account qa-test --action $action --max 2 \
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

## Smoke Test (Copy-Paste)

Run this after any skill code change. Tests the skill **through the proxy** end-to-end.

```bash
cd docs/skills/gmail-fgac/scripts
export FGAC_ROOT_URL=http://localhost:3000
LABEL=qa-test  # Replace with your token label

echo "=== 1. Argument validation ==="
node gmail.js --action labels 2>&1 | grep -q "Usage:" && echo "PASS: no --account" || echo "FAIL"
node gmail.js --account $LABEL --action read 2>&1 | grep -q "message-id is required" && echo "PASS: read without --message-id" || echo "FAIL"
node gmail.js --account $LABEL --action send --subject "x" 2>&1 | grep -q "to is required" && echo "PASS: send without --to" || echo "FAIL"
node gmail.js --account $LABEL --action forward --to x@x.com 2>&1 | grep -q "message-id is required" && echo "PASS: forward without --message-id" || echo "FAIL"
node gmail.js --account $LABEL --action bogus 2>&1 | grep -q "Unknown action" && echo "PASS: invalid action" || echo "FAIL"
node gmail.js --account nonexistent --action labels 2>&1 | grep -q "No token found" && echo "PASS: invalid account" || echo "FAIL"

echo ""
echo "=== 2. Labels (through proxy — auth + routing + Gmail API) ==="
node gmail.js --account $LABEL --action labels \
  | python3 -c "import json,sys; d=json.load(sys.stdin); names=[l['name'] for l in d['labels']]; print(f'Labels: {d[\"count\"]}  INBOX:{\"INBOX\" in names}  SENT:{\"SENT\" in names}'); sys.exit(0 if d['count']>0 else 1)"

echo ""
echo "=== 3. List (through proxy — data flow) ==="
node gmail.js --account $LABEL --action list --max 2 \
  | python3 -c "import json,sys; d=json.load(sys.stdin); m=d['messages'][0]; print(f'Messages: {d[\"count\"]}  Has id/subject/from: {bool(m.get(\"id\"))}/{bool(m.get(\"subject\"))}/{bool(m.get(\"from\"))}'); sys.exit(0 if d['count']>0 else 1)"

echo ""
echo "=== 4. Read (through proxy — full message) ==="
MSG_ID=$(node gmail.js --account $LABEL --action list --max 1 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['id'])")
node gmail.js --account $LABEL --action read --message-id "$MSG_ID" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Subject: {d[\"subject\"][:60]}'); print(f'Body len: {len(d.get(\"body\",\"\"))}'); sys.exit(0 if d.get('body') else 1)"

echo ""
echo "=== 5. JSON output contract ==="
for action in labels list; do
  node gmail.js --account $LABEL --action $action --max 2 2>/dev/null \
    | python3 -c "import json,sys; json.load(sys.stdin); print(f'  $action: VALID JSON')" \
    || echo "  $action: INVALID JSON"
done

echo ""
echo "--- Smoke test complete ---"
```
