# Setup: Rules Configuration

> Extracted from `02_gmail_fine_grain_control.md` and `03_multi_email_multi_key.md`

## Prerequisites
- Setup tests `01_signup_and_credential.md` and `02_multi_account_linking.md` passed
- Three proxy keys created (QA-Agent-A, QA-Agent-B, QA-Power-Agent)
- Both test email accounts connected

## Test 1: Configure Send Whitelist

**Steps (via `/browser-agent`):**
1. In the Web UI, navigate to Gmail Access Controls → Sending Permissions.
2. Add `USER_B_EMAIL` to the **Send Whitelist** (so agents can send to the other test account).
3. Add `allowed@example.com` to the whitelist.
4. Verify the rules appear in the dashboard.

**Expected Outcome**: Send whitelist rules configured and visible.

---

## Test 2: Configure Read Blacklist

**Steps:**
1. Navigate to Gmail Access Controls → Reading Permissions.
2. Add a **Read Blacklist** rule:
   - Rule Name: `Block 2FA Codes`
   - Regex Pattern: `2FA Code|Password Reset|Verification Code`
3. Add another rule:
   - Rule Name: `Block Competitor Emails`
   - Regex Pattern: `*@competitor.com`
4. Apply the "Block Account Security Emails" quick-add template if available.

**Expected Outcome**: Read blacklist rules configured and visible.

---

## Test 3: Configure Global vs Key-Specific Rules

**Steps:**
1. Create a **global rule** (no key assignment):
   - Rule Name: `Global Block 2FA`
   - Action Type: `read_blacklist`
   - Regex: `2FA Code`
   - Key Assignment: *(blank — global)*
2. Create a **key-specific rule**:
   - Rule Name: `Block Competitor for Work Bot`
   - Action Type: `read_blacklist`
   - Regex: `*@competitor.com`
   - Key Assignment: **QA-Agent-B** only
3. Verify the dashboard shows which rules are global vs key-specific.

**Expected Outcome**: Both global and key-scoped rules visible with correct assignments.

---

## Test 4: Configure Deletion Controls

**Steps:**
1. Navigate to Gmail Access Controls → Deletion Permissions.
2. Verify the global safeguard "Prevent permanent deletion" is enabled by default.
3. Configure the **Deletion Whitelist** to only allow deleting emails from `*@spam-newsletter.com`.

**Expected Outcome**: Deletion controls configured. Bulk delete and empty trash blocked.

---

## Verification

- [ ] Send whitelist rules visible
- [ ] Read blacklist rules visible (global + key-specific)
- [ ] Quick-add template applied (if available)
- [ ] Deletion controls configured
- [ ] Screenshot saved as `qa_proof_setup_rules.png`
