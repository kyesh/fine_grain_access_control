---
description: Run all capability tests through Claude Code CLI local scripts
---
# Claude Code CLI QA (/qa-claude-code-cli)

Requires: /qa-setup completed, dev server running.

## Two-Phase Hybrid Testing Model

This workflow uses a **two-phase approach** based on Anthropic's best practices:

### Phase 1: Auth Setup (Interactive, One-Time)

The OAuth DCR + PKCE flow requires interactive browser consent. This must be done once before headless testing:

1. **Run reset**: `bash test/qa-envs/cc-cli/reset.sh`
2. **Authenticate**:
   ```bash
   FGAC_ROOT_URL=http://localhost:3000 node test/qa-envs/cc-cli/.claude/skills/gmail-fgac/scripts/auth.js --action login
   ```
3. **Approve** the connection in the dashboard via `/browser-agent`
4. **Verify** credentials are stored:
   ```bash
   cat ~/.openclaw/gmail-fgac/fgac-credentials.json | jq '.proxy_key, .key_label'
   ```

### Phase 2: Headless Capability Eval (`claude -p`)

Once auth is pre-seeded, ALL capability assertions run headlessly via the eval suite:

```bash
cd test/qa-envs/cc-cli && bash evals/run_evals.sh
```

Or run a single test:
```bash
cd test/qa-envs/cc-cli && bash evals/run_evals.sh --filter A1
```

This uses `claude -p` (print/headless mode) with:
- `--output-format json` — structured, parseable results
- `--allowedTools "Bash(node:*)"` — restricted to skill scripts
- `--max-turns 5` — prevents runaway execution
- `--dangerously-skip-permissions` — unattended execution

> **Why not tmux?** The previous tmux-based approach was fragile (alternate screen buffer issues, timing, usage credits throttling). `claude -p` is deterministic, fast (10-15s per test), and CI/CD compatible.

## Coverage Report (Required)

The eval suite produces a pass/fail report automatically. Cross-reference against
`docs/QA_Acceptance_Test/capabilities/` for full coverage:

```
| Cap | Assertion | Status | Duration | Notes |
|-----|-----------|--------|----------|-------|
| 01  | A1        | ✅/❌/⏭️ | 10s      |       |
| 01  | A2        | ✅/❌/⏭️ | 15s      |       |
...
```

All assertions must be accounted for. Any ⏭️ (skipped) must include a reason.

## Adding New Test Cases

Add entries to `test/qa-envs/cc-cli/evals/test_cases.json`:
```json
{
  "id": "A5",
  "capability": "02_read_blacklist",
  "name": "Read blocked competitor email",
  "prompt": "Using gmail-fgac, search for emails from spy@competitor.com",
  "assert_pattern": "blocked|filtered|no results",
  "expect_exit": 0,
  "max_turns": 5
}
```

## Fallback: Interactive TUI Testing

If headless testing is insufficient (e.g., testing slash command UI, skill discovery banner), use the tmux fallback:
```bash
tmux new-session -d -s fgac-cli-qa -x 200 -y 50 "cd test/qa-envs/cc-cli && claude --dangerously-skip-permissions"
tmux send-keys -t fgac-cli-qa "What skills do you have available?" Enter
```

This should be rare — most capability assertions work via `claude -p`.
