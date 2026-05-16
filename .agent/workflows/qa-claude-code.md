---
description: Run all capability tests through Claude Code MCP via tmux
---
# Claude Code MCP QA (/qa-claude-code)

Requires: /qa-setup completed, dev server running, tmux + playwright available.

Read and execute: `docs/QA_Acceptance_Test/agents/02_claude_code_mcp.md`

This doc runs ALL capabilities via tmux + playwright.
Capability assertions are defined in `docs/QA_Acceptance_Test/capabilities/`.
If new capability files are added there, the agent doc must be updated to cover them.
