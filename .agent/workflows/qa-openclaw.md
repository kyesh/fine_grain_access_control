---
description: Run all capability tests through a genuine OpenClaw Docker instance
---
# OpenClaw QA (/qa-openclaw)

Requires: /qa-setup completed, dev server running, Docker available.

Read and execute: `docs/QA_Acceptance_Test/agents/04_openclaw.md`

This doc starts a real OpenClaw container and runs ALL capabilities
through the gateway API — not standalone scripts.
Capability assertions are defined in `docs/QA_Acceptance_Test/capabilities/`.
If new capability files are added there, the agent doc must be updated to cover them.
