---
description: Validate production via real distribution channels (all 4 agents)
---
# Production QA (/qa-production)

Requires: Production deployment live at fgac.ai.

Discover and execute ALL production docs in order:
`ls docs/QA_Acceptance_Test/production/*.md | sort`

For each file, read it and follow its instructions.
The 00_ file is the smoke test; 01_-04_ are per-agent channel tests.
Each agent doc installs from the real distribution channel,
then runs ALL capabilities against production URLs.
