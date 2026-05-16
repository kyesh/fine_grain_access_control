---
description: Bootstrap QA environment via browser agent
---
# QA Setup (/qa-setup)

// turbo-all

## Steps

1. Pull secrets: `bash scripts/qa-secrets.sh`
2. Read `.qa_test_emails.json` for USER_A and USER_B
3. Verify dev server running: `curl -sf http://localhost:3000`
4. Discover and execute ALL setup docs in order:
   `ls docs/QA_Acceptance_Test/setup/*.md | sort`
   For each file, read it and follow its instructions using /browser-agent.
5. Screenshot final dashboard state as proof: `qa_proof_setup.png`
