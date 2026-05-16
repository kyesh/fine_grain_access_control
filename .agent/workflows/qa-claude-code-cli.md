---
description: Run all capability tests through Claude Code CLI local scripts
---
# Claude Code CLI QA (/qa-claude-code-cli)

Requires: /qa-setup completed, dev server running.

Read and execute: `docs/QA_Acceptance_Test/agents/03_claude_code_cli.md`

This doc runs ALL capabilities via local scripts (auth.js, gmail.js) — 
the same scripts shared with the OpenClaw skill.
Capability assertions are defined in `docs/QA_Acceptance_Test/capabilities/`.
If new capability files are added there, the agent doc must be updated to cover them.
