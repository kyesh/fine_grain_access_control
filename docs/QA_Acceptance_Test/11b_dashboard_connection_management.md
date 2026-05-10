# QA Test 11b — Dashboard Connection Management

## Objective
Validate the dashboard UI for managing agent connections: pending display, approval, blocking, nickname editing, and multi-agent views.

> **All tests in this file use the `/browser-agent` workflow.**

## Prerequisites
- [ ] Dev server running (`npm run dev`) or Vercel preview deployed
- [ ] Chrome running with remote debugging: `google-chrome-stable --remote-debugging-port=9222 --user-data-dir="$(pwd)/.playwright_user_data"`
- [ ] User signed in to the dashboard in Chrome
- [ ] At least one pending agent connection (from QA 11a Test 3)
- [ ] At least one proxy key available

---

## Test 1: Pending Connection Appears

**Steps (via `/browser-agent`):**
```bash
npx @playwright/cli attach --cdp=http://localhost:9222 -s=qa_11b
npx @playwright/cli -s=qa_11b goto $BASE_URL/dashboard
npx @playwright/cli -s=qa_11b snapshot
```

**Expected:**
- [ ] "Agent Connections" section visible on dashboard
- [ ] Pending connection card visible with amber border and pulse animation
- [ ] Card shows: DCR client name, nickname input, proxy key dropdown, Approve/Block buttons
- [ ] If no connections exist, shows "No agent connections yet"

**Screenshot:**
```bash
npx @playwright/cli -s=qa_11b screenshot qa_11b_test1_pending.png
```

---

## Test 2: Approve Connection

**Steps:**
1. From Test 1 snapshot, identify the proxy key dropdown element ref
2. Select a proxy key:
   ```bash
   npx @playwright/cli -s=qa_11b select e<dropdown_ref> "<proxy_key_id>"
   ```
3. Enter a nickname:
   ```bash
   npx @playwright/cli -s=qa_11b fill e<nickname_ref> "My Test Agent"
   ```
4. Click Approve:
   ```bash
   npx @playwright/cli -s=qa_11b click e<approve_ref>
   ```
5. Take snapshot and screenshot:
   ```bash
   npx @playwright/cli -s=qa_11b snapshot
   npx @playwright/cli -s=qa_11b screenshot qa_11b_test2_approved.png
   ```

**Expected:**
- [ ] Connection moves from "Pending" to "Approved" section
- [ ] Nickname "My Test Agent" shown prominently
- [ ] DCR client_name shown as subtitle
- [ ] Proxy key label visible
- [ ] Pulse animation stops

---

## Test 3: Block a Connection

**Steps:**
1. For an approved connection, click the Block button:
   ```bash
   npx @playwright/cli -s=qa_11b click e<block_ref>
   ```
2. Take snapshot:
   ```bash
   npx @playwright/cli -s=qa_11b snapshot
   npx @playwright/cli -s=qa_11b screenshot qa_11b_test3_blocked.png
   ```

**Expected:**
- [ ] Connection appears in "Blocked" section
- [ ] Card is greyed out / visually distinct
- [ ] Option to unblock is available

---

## Test 4: Nickname Editing (Inline)

**Steps:**
1. For an approved connection, click the nickname text to enter edit mode:
   ```bash
   npx @playwright/cli -s=qa_11b click e<nickname_text_ref>
   ```
2. Clear and type new nickname:
   ```bash
   npx @playwright/cli -s=qa_11b fill e<nickname_input_ref> "Renamed Agent"
   ```
3. Press Enter or click Save
4. Take snapshot:
   ```bash
   npx @playwright/cli -s=qa_11b snapshot
   ```

**Expected:**
- [ ] Nickname updates immediately in the UI
- [ ] No page reload required
- [ ] New nickname persists on page refresh

---

## Test 5: Unblock a Connection

**Steps:**
1. For a blocked connection, click the Unblock/Approve button:
   ```bash
   npx @playwright/cli -s=qa_11b click e<unblock_ref>
   ```
2. Take snapshot:
   ```bash
   npx @playwright/cli -s=qa_11b snapshot
   npx @playwright/cli -s=qa_11b screenshot qa_11b_test5_unblocked.png
   ```

**Expected:**
- [ ] Connection moves back to "Approved" section
- [ ] Agent can use tools again (verify via QA 11a Test 4)

---

## Test 6: Multiple Agents Visible

**Steps:**
1. Ensure at least 2 agent connections exist (pending, approved, or blocked)
2. Navigate to dashboard and snapshot:
   ```bash
   npx @playwright/cli -s=qa_11b goto $BASE_URL/dashboard
   npx @playwright/cli -s=qa_11b snapshot
   npx @playwright/cli -s=qa_11b screenshot qa_11b_test6_multi_agent.png
   ```

**Expected:**
- [ ] Both agent connections visible with distinct nicknames/client names
- [ ] Each shows its own status (pending/approved/blocked)
- [ ] Each has its own proxy key assignment

---

## Cleanup

```bash
npx @playwright/cli -s=qa_11b close
```
