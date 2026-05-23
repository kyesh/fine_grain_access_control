# QA Report Follow-Up: Fixes & Process Improvements

Addresses 6 action items from user comments on the QA report.

---

## Answers to Your Questions

### "Will `--turbopack=false` impact production?"

**No.** Production uses `next build` → `next start`, which does **not** use Turbopack at all. Turbopack is dev-mode only (used by `next dev`). Adding `--turbopack=false` to a `dev:qa` script only affects local QA sessions — it falls back to Webpack for the dev server, which uses less memory but has slower hot-reload. Production builds are completely unaffected.

### "Should CC MCP key-binding docs be in the workflow or the test .md file?"

**In the agent test doc** ([02_claude_code_mcp.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/agents/02_claude_code_mcp.md)). The workflow file (`/qa-claude-code`) is just a 13-line pointer that says "read and execute the agent doc." The agent doc is where all CC MCP-specific setup lives (tmux launch, `/mcp` commands, auth flow). The key-binding prerequisite belongs there, in the "Auth Setup" section.

### "Why were so many tests missed?"

Three root causes:

1. **Setup phase was skipped.** The `/qa-setup` workflow requires running all 3 setup docs (`01_signup_and_credential.md` → `02_multi_account_linking.md` → `03_rules_configuration.md`) **in order**. We ran parts of setup 01 and 03, but **completely skipped setup 02** (multi-account linking). This meant no USER_B sign-up, no delegation, no multi-key creation — which cascaded into caps 03/04/05/07 being untestable.

2. **Agent docs weren't followed assertion-by-assertion.** Instead of reading [02_claude_code_mcp.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/agents/02_claude_code_mcp.md) and executing each assertion, we improvised a subset of tests based on what was available. The docs explicitly list every assertion with executable commands — they just weren't followed.

3. **No coverage tracking against the capability matrix.** We counted "tests run" but never cross-referenced against the 48 defined assertions in `capabilities/`. The `/qa-setup` + `/qa-*` workflows don't produce a coverage report.

### "Isn't the second test user outlined in the QA test instructions?"

**Yes, exactly.** [setup/02_multi_account_linking.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/setup/02_multi_account_linking.md) explicitly says:
- Test 2: "Sign out of FGAC → Sign up as USER_B_EMAIL"
- Test 3: "While signed in as USER_B, delegate to USER_A"
- Test 5: "Create QA-Agent-A, QA-Agent-B, QA-Power-Agent keys"

This is already a prerequisite for caps 03 (multi-email) and 04 (delegation). The tests were missed because the setup phase was skipped, not because the instructions are missing.

---

## Proposed Changes

### 1. Fix Duplicate Rules Bug

#### [MODIFY] [actions.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/actions.ts)

**Fix 1 — Application-layer dedup guard** in `applyRecommendedSecurityRules()`:
- Before inserting, query existing `read_blacklist` rules for this user
- If any exist, return early (no-op)
- This prevents duplicate rows regardless of how many times the button is clicked

```diff
 export async function applyRecommendedSecurityRules() {
   const dbUser = await getDbUser();
+
+  // Guard: skip if user already has read_blacklist rules
+  const existing = await db.select().from(accessRules)
+    .where(and(
+      eq(accessRules.userId, dbUser.id),
+      eq(accessRules.actionType, 'read_blacklist'),
+    ));
+  if (existing.length > 0) {
+    revalidatePath("/dashboard");
+    return;
+  }
+
   const rulesToInsert = [
```

#### [MODIFY] [RuleControls.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/RuleControls.tsx)

**Fix 2 — UI-layer guard**: Accept an `existingRules` prop, disable the button when `read_blacklist` rules already exist:

```diff
-export default function RuleControls({...}) {
+export default function RuleControls({ existingRules, ...}) {
+  const hasBlacklistRules = existingRules?.some(r => r.actionType === 'read_blacklist');
   ...
   <button
     onClick={...}
-    disabled={isPending}
+    disabled={isPending || hasBlacklistRules}
+    title={hasBlacklistRules ? "Security rules already applied" : undefined}
   >
```

Parent dashboard page will need to pass `existingRules` prop down.

---

### 2. Add NODE_OPTIONS to Dev Script

#### [MODIFY] [package.json](file:///home/kyesh/GitRepos/fine_grain_access_control/package.json)

```diff
-    "dev": "next dev",
+    "dev": "NODE_OPTIONS='--max-old-space-size=8192' next dev",
+    "dev:qa": "NODE_OPTIONS='--max-old-space-size=8192' next dev --turbopack=false",
```

- `dev` gets the 8GB heap limit for normal development
- `dev:qa` additionally disables Turbopack for QA sessions (lower memory, no leaks)
- Neither affects production (`next build` doesn't use Turbopack)

---

### 3. Add Turbopack Cache Clear to QA Setup

#### [MODIFY] [qa-setup.md](file:///home/kyesh/GitRepos/fine_grain_access_control/.agent/workflows/qa-setup.md)

Add a step before starting the dev server to clear the Turbopack cache:

```diff
 ## Steps
 
 1. Pull secrets: `bash scripts/qa-secrets.sh`
 2. Read `.qa_test_emails.json` for USER_A and USER_B
-3. Verify dev server running: `curl -sf http://localhost:3000`
+3. Clear Turbopack cache and start dev server:
+   ```bash
+   rm -rf .next/dev
+   npm run dev:qa  # Uses --turbopack=false to prevent memory leaks
+   ```
+4. Verify dev server running: `curl -sf http://localhost:3000`
```

---

### 4. Document CC MCP Key-Binding in Agent Doc

#### [MODIFY] [02_claude_code_mcp.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/agents/02_claude_code_mcp.md)

Add a warning to the "Auth Setup" section explaining that Claude Code reuses its client ID across sessions, so existing connections may auto-match to a stale key binding:

```diff
 ## Auth Setup
 
+> [!WARNING]
+> **Existing Connection Re-use**: Claude Code's MCP transport uses a stable
+> client ID. If a previous QA cycle already created and approved a connection
+> for this client, new OAuth flows will auto-match to the existing connection
+> and its bound proxy key. Before running tests:
+> 1. Navigate to `http://localhost:3000/dashboard?tab=connections`
+> 2. Find any existing approved connection for this Claude Code client
+> 3. Verify it is bound to `QA-Agent-A` (or the intended test key)
+> 4. If bound to the wrong key: **Block** it, then re-approve with the correct key
+
 1. Start MCP auth:
```

---

### 5. Process Improvements to Prevent Missing Tests

> [!IMPORTANT]
> The root cause of the coverage gap was **not following the existing setup docs in order**. The docs are well-structured and already define everything needed. The fix is process enforcement, not new documentation.

#### [MODIFY] [qa-setup.md](file:///home/kyesh/GitRepos/fine_grain_access_control/.agent/workflows/qa-setup.md)

Add a mandatory coverage checkpoint at the end:

```diff
 5. Screenshot final dashboard state as proof: `qa_proof_setup.png`
+6. **Coverage Checkpoint**: Verify all setup prerequisites are met:
+   - [ ] USER_A signed up and Google account connected
+   - [ ] USER_B signed up as separate FGAC user
+   - [ ] USER_B delegated their email to USER_A
+   - [ ] Three proxy keys created: QA-Agent-A, QA-Agent-B, QA-Power-Agent
+   - [ ] Quick-add 2FA block rules applied (exactly once)
+   - [ ] Send whitelist rule created
+   - [ ] Key-specific read blacklist rule created (assigned to QA-Agent-B only)
+   - [ ] If any item is unchecked, STOP — re-run the relevant setup doc before proceeding
```

#### [MODIFY] Each `/qa-*` agent workflow

Add assertion-level tracking. After each capability section, the agent must report which assertions passed/failed/skipped against the canonical list in `capabilities/`:

```diff
+## Coverage Report
+
+After running all capabilities, generate a coverage matrix:
+```
+| Cap | Assertion | Status | Notes |
+|-----|-----------|--------|-------|
+| 01  | A1        | ✅/❌/⏭️ |       |
+| 01  | A2        | ✅/❌/⏭️ |       |
+...
+```
+All 48 assertions must be accounted for. Any ⏭️ (skipped) must include a reason.
```

---

## Verification Plan

### Automated Tests
1. Verify `applyRecommendedSecurityRules` dedup:
   - Click "Quick Add 2FA Block" when rules already exist → no new rows created
   - Button shows disabled state with tooltip
2. Verify `npm run dev` starts with 8GB heap:
   ```bash
   npm run dev & sleep 3 && ps aux | grep 'max-old-space-size' && kill %1
   ```
3. Verify `npm run dev:qa` disables Turbopack:
   ```bash
   npm run dev:qa & sleep 3 && ps aux | grep 'turbopack' && kill %1
   ```

### Manual Verification
- Dashboard: confirm "Quick Add 2FA Block" button is disabled when rules exist
- Run `npm run build` to verify production is unaffected by dev script changes
