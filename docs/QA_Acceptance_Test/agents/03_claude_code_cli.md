# Agent: Claude Code CLI (Local Scripts)

> Runs ALL capabilities via Claude Code invoking local scripts (auth.js, gmail.js).
> Package #4 from distribution_architecture.md — shares scripts with OpenClaw skill.

## Testing Model: Two-Phase Hybrid

This agent uses a **two-phase hybrid testing approach** based on Anthropic's best practices
for skill testing. Phase 1 handles interactive auth, Phase 2 uses `claude -p` headless mode.

### Phase 1: Auth Setup (Interactive, One-Time)

1. **Run reset**: `bash test/qa-envs/cc-cli/reset.sh`
   - Copies plugin into `.claude/skills/fgac/` (mimics marketplace install)
   - Installs npm dependencies
2. **Authenticate**:
   ```bash
   FGAC_ROOT_URL=http://localhost:3000 node test/qa-envs/cc-cli/.claude/skills/fgac/scripts/auth.js --action login
   ```
   Complete OAuth in browser via `/browser-agent`, then approve connection in dashboard:
   Navigate to `http://localhost:3000/dashboard?tab=connections`, find the pending connection,
   select a proxy key and click **Approve**.
   ⚠️ NEVER approve connections via direct DB writes — always use the Web UI.
3. **Retrieve proxy key**:
   ```bash
   FGAC_ROOT_URL=http://localhost:3000 node test/qa-envs/cc-cli/.claude/skills/fgac/scripts/auth.js --action status
   ```
4. **Verify credentials exist**:
   ```bash
   test -f ~/.openclaw/fgac/fgac-credentials.json && echo "✅ Auth ready" || echo "❌ Auth needed"
   ```

### Phase 2: Headless Capability Eval (`claude -p`)

Once auth is pre-seeded, run the eval suite:
```bash
cd test/qa-envs/cc-cli && bash evals/run_evals.sh
```

This runs each test case via `claude -p` (non-interactive mode) with:
- `--output-format json` — structured results with tool calls, cost, turns
- `--allowedTools "Bash(node:*)"` — restricted to skill scripts
- `--max-turns 5` — prevents runaway execution
- `--dangerously-skip-permissions` — unattended execution

> **Key insight**: Slash commands (`/fgac`) are interactive-only. In `-p` mode,
> prompts reference the skill by its trigger description in natural language
> (e.g., "Using the fgac skill, ...").

## Proof of Authenticity

> Evidence that Claude Code discovers and invokes the skill (not a test harness):

- [ ] `claude -p` JSON output contains `num_turns > 1` (Claude made tool calls)
- [ ] Result JSON shows Bash tool invocations in the `usage.iterations` array
- [ ] Output references specific script behavior (FGAC proxy, Message IDs)

---

## Capability: Send Whitelist (→ capabilities/01_send_whitelist.md)

### A1: Send to whitelisted address
```bash
claude -p "Using the fgac skill, send an email to \$USER_B_EMAIL with subject 'QA CC CLI - Send Whitelist A1' and body 'Test'" \
  --allowedTools "Bash(node:*)" --output-format json --max-turns 5 --dangerously-skip-permissions
```
- [ ] Result contains "sent successfully" or "Message ID"

### A2: Send to blocked address
```bash
claude -p "Using the fgac skill, send an email to blocked@untrusted.com with subject 'Should Block' and body 'Test'" \
  --allowedTools "Bash(node:*)" --output-format json --max-turns 5 --dangerously-skip-permissions
```
- [ ] Result contains "blocked", "403", "Unauthorized", or "whitelist"

---

## Capability: Read Blacklist (→ capabilities/02_read_blacklist.md)

### A3: Read normal email
```bash
claude -p "Using the fgac skill, list my 5 most recent emails" \
  --allowedTools "Bash(node:*)" --output-format json --max-turns 5 --dangerously-skip-permissions
```
- [ ] Result contains email subjects/senders or appropriate rule-based block message

---

## Capability: Multi-Email Scoping (→ capabilities/03_multi_email_scoping.md)

### A4: List accounts
```bash
claude -p "Using the fgac skill, what email accounts can I access?" \
  --allowedTools "Bash(node:*)" --output-format json --max-turns 5 --dangerously-skip-permissions
```
- [ ] Result shows mapped email addresses

---

## Capability: Delegation (→ capabilities/04_delegation.md)

### A6: List accounts shows delegated
- [ ] accounts.js returns both own and delegated emails

---

## Capability: Connection Lifecycle (→ capabilities/06_connection_lifecycle.md)

### A3-A5: Tested during Phase 1 auth setup
- [ ] OAuth → pending → approved → tools work

---

## Capability: Key Lifecycle (→ capabilities/07_key_lifecycle.md)

### A1: After key revocation
- [ ] Script returns auth error

---

## Capability: Label Access (→ capabilities/05_label_access.md)

- [ ] Label rules enforced when reading via scripts

---

## Capability: Light Mode (→ capabilities/08_strict_light_mode.md)

> Tested via browser agent — same for all agents.

---

## Automated vs Manual Test Coverage

| Test | Method | Automated? |
|------|--------|------------|
| A1: Send whitelist | `claude -p` eval suite | ✅ |
| A2: Send blocked | `claude -p` eval suite | ✅ |
| A3: Read emails | `claude -p` eval suite | ✅ |
| A4: List accounts | `claude -p` eval suite | ✅ |
| A5: Connection lifecycle | Phase 1 (interactive) | Manual |
| A6: Delegation | `claude -p` eval suite | ✅ |
| A7: Key revocation | `claude -p` eval suite | ✅ |
| A8: Light mode | Browser agent | Manual |

---

## Cleanup

No tmux sessions to clean up. Results are saved to `test/qa-envs/cc-cli/evals/results/`.

## Capability: Partner Handoff (→ capabilities/11_partner_handoff.md)

> Channel-inapplicable here: the handoff is a browser + REST surface, executed
> once per cycle via agents/01_hosted_mcp.md. Record as skip with reason
> "runs in hosted-mcp runbook".

## Capability: Push Notifications (→ capabilities/12_push_notifications.md)

> Channel-inapplicable here: server-side pipeline, executed once per cycle via
> agents/01_hosted_mcp.md. Record as skip with reason "runs in hosted-mcp runbook".
