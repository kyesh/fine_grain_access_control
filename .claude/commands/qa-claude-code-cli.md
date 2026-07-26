---
description: Run all capability tests through Claude Code CLI local scripts (headless `claude -p` evals)
argument-hint: [--filter A1]
allowed-tools: Bash(bash test/qa-envs/cc-cli/reset.sh), Bash(node test/qa-envs/cc-cli/:*), Bash(bash evals/run_evals.sh:*), Bash(cat:*), Bash(jq:*), Bash(tmux:*), Read, Glob
---

# Claude Code CLI QA

Requires: `/qa-setup` completed, dev server running. Optional filter: `$ARGUMENTS`

## Two-Phase Hybrid Testing Model

### Phase 1: Auth Setup (interactive, one-time)

The OAuth DCR + PKCE flow needs interactive browser consent. Do this once before headless testing:

1. **Reset**:
   ```bash
   bash test/qa-envs/cc-cli/reset.sh
   ```
2. **Authenticate**:
   ```bash
   FGAC_ROOT_URL=http://localhost:3000 node test/qa-envs/cc-cli/.claude/skills/fgac/scripts/auth.js --action login
   ```
3. **Approve** the connection in the dashboard via `/browser-agent`.
4. **Verify** credentials are stored:
   ```bash
   cat ~/.openclaw/fgac/fgac-credentials.json | jq '.proxy_key, .key_label'
   ```

### Phase 2: Headless Capability Eval (`claude -p`)

With auth pre-seeded, ALL capability assertions run headlessly:

```bash
cd test/qa-envs/cc-cli && bash evals/run_evals.sh
```

Single test:
```bash
cd test/qa-envs/cc-cli && bash evals/run_evals.sh --filter A1
```

The runner uses `claude -p` (print/headless mode) with:
- `--output-format json` — structured, parseable results
- `--allowedTools "Bash(node:*)"` — restricted to skill scripts
- `--max-turns 5` — prevents runaway execution
- `--dangerously-skip-permissions` — unattended execution

> **Why not tmux?** The earlier tmux approach was fragile (alternate screen buffer issues,
> timing, usage throttling). `claude -p` is deterministic, fast (10–15s per test), and CI/CD
> compatible.

## Coverage Report (Required)

The eval suite emits a pass/fail report automatically. Cross-reference it against
`docs/QA_Acceptance_Test/capabilities/` for full coverage:

```
| Cap | Assertion | Status | Duration | Notes |
|-----|-----------|--------|----------|-------|
| 01  | A1        | ✅/❌/⏭️ | 10s      |       |
| 01  | A2        | ✅/❌/⏭️ | 15s      |       |
...
```

All assertions must be accounted for. Any ⏭️ (skipped) must include a reason. Report failures
with the actual output — never mark a test passing on an assumption.

## Adding New Test Cases

Add entries to `test/qa-envs/cc-cli/evals/test_cases.json`:

```json
{
  "id": "A5",
  "capability": "02_read_blacklist",
  "name": "Read blocked competitor email",
  "prompt": "Using fgac, search for emails from spy@competitor.com",
  "assert_pattern": "blocked|filtered|no results",
  "expect_exit": 0,
  "max_turns": 5
}
```

## Fallback: Interactive TUI Testing

If headless testing is insufficient (e.g. testing slash command UI or the skill discovery
banner), use the tmux fallback:

```bash
tmux new-session -d -s fgac-cli-qa -x 200 -y 50 "cd test/qa-envs/cc-cli && claude --dangerously-skip-permissions"
tmux send-keys -t fgac-cli-qa "What skills do you have available?" Enter
```

This should be rare — most capability assertions work via `claude -p`.
