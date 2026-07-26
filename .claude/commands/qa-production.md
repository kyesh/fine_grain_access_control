---
description: Validate production via real distribution channels (all 4 agents)
allowed-tools: Bash(curl:*), Bash(jq:*), Bash(ls:*), Bash(docker:*), Bash(npx:*), Read, Glob
---

# Production QA

Requires: production deployment live at fgac.ai.

Discover and execute ALL production docs in order:

```bash
ls docs/QA_Acceptance_Test/production/*.md | sort
```

For each file, read it and follow its instructions. The `00_` file is the smoke test; `01_`–`04_`
are the per-agent channel tests. Each agent doc installs from the real distribution channel,
then runs ALL capabilities against production URLs.

> **Read-only against production.** This workflow validates a deployment that already exists.
> Never trigger a production deploy from here — `vercel --prod`, `vercel promote`, and
> `vercel alias` are banned. Deployments are the user's call via `/deploy-prod`.

Report failures honestly with the actual output, and account for every assertion.
