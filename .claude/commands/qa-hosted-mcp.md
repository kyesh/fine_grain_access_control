---
description: Run all capability tests through the Hosted MCP interface
allowed-tools: Bash(curl:*), Bash(jq:*), Bash(ls:*), Read, Glob
---

# Hosted MCP QA

Requires: `/qa-setup` completed, dev server running.

Read and execute: `docs/QA_Acceptance_Test/agents/01_hosted_mcp.md`

That doc runs ALL capabilities via curl against the MCP endpoint. Capability assertions are
defined in `docs/QA_Acceptance_Test/capabilities/`. If new capability files have been added
there, the agent doc must be updated to cover them.

## Coverage Report (Required)

After running all capabilities, generate a coverage matrix in the QA report. Cross-reference
every assertion in `docs/QA_Acceptance_Test/capabilities/` against actual results:

```
| Cap | Assertion | Status | Notes |
|-----|-----------|--------|-------|
| 01  | A1        | ✅/❌/⏭️ |       |
| 01  | A2        | ✅/❌/⏭️ |       |
...
```

All 48 assertions must be accounted for. Any ⏭️ (skipped) must include a reason
(e.g. "Setup 02 not run"). Report failures honestly with the actual output — never mark a test
passing on the basis of an assumption.
