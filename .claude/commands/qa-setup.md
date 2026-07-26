---
description: Bootstrap the QA environment (secrets, dev server, setup docs) via the browser agent
allowed-tools: Bash(bash scripts/qa-secrets.sh), Bash(npm run dev:qa), Bash(curl:*), Bash(ls:*), Bash(cat .qa_test_emails.json), Bash(jq:*), Read, Glob
---

# QA Setup

Prepares the environment every other `/qa-*` workflow depends on.

## Steps

1. **Pull secrets**:
   ```bash
   bash scripts/qa-secrets.sh
   ```

2. **Read `.qa_test_emails.json`** for `USER_A` and `USER_B`.

3. **Start the QA dev server** (clears the `.next/dev` cache, uses Webpack rather than
   Turbopack to avoid memory leaks, 8GB heap). Run it in the background so it keeps running
   across the rest of the QA:
   ```bash
   npm run dev:qa
   ```

4. **Verify the dev server is up**:
   ```bash
   curl -sf http://localhost:3000
   ```

5. **Discover and execute ALL setup docs in order**:
   ```bash
   ls docs/QA_Acceptance_Test/setup/*.md | sort
   ```
   Read each file and follow its instructions using `/browser-agent`.

   > **CRITICAL**: Do NOT skip any setup doc. Setup 02 (multi-account linking) establishes
   > USER_B, delegation, and multi-key creation — without it, capabilities 03, 04, 05, and 07
   > are untestable.

   > **CRITICAL**: Do NOT shortcut setup by writing to the database. All state changes go
   > through the Web UI, exactly as a real user would (see CLAUDE.md, Database Rule 7).

6. **Screenshot the final dashboard state** as proof, into the gitignored directory:
   `.playwright/qa_proof_setup.png`

7. **Coverage Checkpoint** — verify ALL prerequisites before proceeding:
   - [ ] USER_A signed up and Google account connected
   - [ ] USER_B signed up as a separate FGAC user
   - [ ] USER_B delegated their email to USER_A
   - [ ] Three proxy keys created: QA-Agent-A, QA-Agent-B, QA-Power-Agent
   - [ ] Quick-add 2FA block rules applied (exactly once — the button should read "✓ 2FA Block Applied")
   - [ ] Send whitelist rule created
   - [ ] Key-specific read blacklist rule created (assigned to QA-Agent-B only)

   If any item is unchecked, **STOP** — re-run the relevant setup doc before running agent tests.
