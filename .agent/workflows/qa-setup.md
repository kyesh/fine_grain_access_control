---
description: Bootstrap QA environment via browser agent
---
# QA Setup (/qa-setup)

// turbo-all

## Steps

1. Pull secrets: `bash scripts/qa-secrets.sh`
2. Read `.qa_test_emails.json` for USER_A and USER_B
3. Clear Turbopack cache and start dev server for QA:
   ```bash
   npm run dev:qa  # Clears .next/dev cache, disables Turbopack, 8GB heap
   ```
4. Verify dev server running: `curl -sf http://localhost:3000`
5. Discover and execute ALL setup docs **in order**:
   `ls docs/QA_Acceptance_Test/setup/*.md | sort`
   For each file, read it and follow its instructions using /browser-agent.
   > **CRITICAL**: Do NOT skip any setup doc. Setup 02 (multi-account linking)
   > establishes USER_B, delegation, and multi-key creation — without it,
   > capabilities 03, 04, 05, and 07 are untestable.
6. Screenshot final dashboard state as proof: `qa_proof_setup.png`
7. **Coverage Checkpoint** — Verify ALL setup prerequisites are met before proceeding:
   - [ ] USER_A signed up and Google account connected
   - [ ] USER_B signed up as separate FGAC user
   - [ ] USER_B delegated their email to USER_A
   - [ ] Three proxy keys created: QA-Agent-A, QA-Agent-B, QA-Power-Agent
   - [ ] Quick-add 2FA block rules applied (exactly once — button should show "✓ 2FA Block Applied")
   - [ ] Send whitelist rule created
   - [ ] Key-specific read blacklist rule created (assigned to QA-Agent-B only)
   - [ ] If any item is unchecked, STOP — re-run the relevant setup doc before proceeding to agent tests
