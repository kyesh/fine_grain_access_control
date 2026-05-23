---
description: Run all capability tests through Claude Code MCP via tmux
---
# Claude Code MCP QA (/qa-claude-code)

Requires: /qa-setup completed, dev server running, tmux + playwright available.

Read and execute: `docs/QA_Acceptance_Test/agents/02_claude_code_mcp.md`

This doc runs ALL capabilities via tmux + playwright.
Capability assertions are defined in `docs/QA_Acceptance_Test/capabilities/`.
If new capability files are added there, the agent doc must be updated to cover them.

## Coverage Report (Required)

After running all capabilities, generate a coverage matrix in the QA report artifact.
Cross-reference every assertion in `docs/QA_Acceptance_Test/capabilities/` against actual test results:

```
| Cap | Assertion | Status | Notes |
|-----|-----------|--------|-------|
| 01  | A1        | ✅/❌/⏭️ |       |
| 01  | A2        | ✅/❌/⏭️ |       |
...
```

All 48 assertions must be accounted for. Any ⏭️ (skipped) must include a reason (e.g., "Setup 02 not run").
