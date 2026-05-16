# Agent: Claude Code CLI (Local Scripts)

> Runs ALL capabilities via Claude Code invoking local scripts (auth.js, gmail.js).
> Package #4 from distribution_architecture.md — shares scripts with OpenClaw skill.

## Prerequisites
- `/qa-setup` completed (keys, rules, emails configured)
- Dev server running at `http://localhost:3000`
- FGAC skill scripts installed locally (from `docs/skills/gmail-fgac/scripts/`)
- `tmux` installed
- Chrome running with remote debugging at `localhost:9222` (for OAuth consent)

## Auth Setup

1. Start Claude Code in tmux:
   ```bash
   tmux new-session -d -s fgac-cli-qa -x 200 -y 50 "claude --dangerously-skip-permissions"
   ```
2. Wait for prompt, then instruct Claude to authenticate:
   ```bash
   tmux send-keys -t fgac-cli-qa "Run: FGAC_ROOT_URL=http://localhost:3000 node docs/skills/gmail-fgac/scripts/auth.js --action login" Enter
   ```
3. OAuth flow opens in browser — auto-consent via playwright
4. Approve connection in dashboard
5. Verify auth status:
   ```bash
   tmux send-keys -t fgac-cli-qa "Run: FGAC_ROOT_URL=http://localhost:3000 node docs/skills/gmail-fgac/scripts/auth.js --action status" Enter
   ```

## Proof of Authenticity

> The following evidence proves Claude Code is invoking the scripts (not the test harness):

- [ ] `tmux capture-pane` shows Claude Code's TUI rendering the script command + output
- [ ] Claude decides which script to invoke based on the prompt (not hardcoded)
- [ ] Output passes through Claude's reasoning, not just raw stdout

---

## Capability: Send Whitelist (→ capabilities/01_send_whitelist.md)

### A1: Send to whitelisted address
```bash
tmux send-keys -t fgac-cli-qa "Send an email to $USER_B_EMAIL with subject 'QA CC CLI - Send Whitelist A1' using the gmail-fgac skill" Enter
```
- [ ] Claude invokes `gmail.js --action send`, email sent

### A2: Send to blocked address
```bash
tmux send-keys -t fgac-cli-qa "Send an email to blocked@untrusted.com with subject 'Blocked' using gmail-fgac" Enter
```
- [ ] Claude reports whitelist error from script output

---

## Capability: Read Blacklist (→ capabilities/02_read_blacklist.md)

### A4: Read normal email
```bash
tmux send-keys -t fgac-cli-qa "List my recent emails using gmail-fgac" Enter
```
- [ ] Claude invokes `gmail.js --action list`, returns emails

---

## Capability: Multi-Email Scoping (→ capabilities/03_multi_email_scoping.md)

### A1: List accounts
```bash
tmux send-keys -t fgac-cli-qa "What email accounts can I access via gmail-fgac?" Enter
```
- [ ] Claude invokes `accounts.js --action list`, shows mapped emails

---

## Capability: Delegation (→ capabilities/04_delegation.md)

### A6: List accounts shows delegated
- [ ] accounts.js returns both own and delegated emails

---

## Capability: Connection Lifecycle (→ capabilities/06_connection_lifecycle.md)

### A3-A5: Tested during auth setup
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

## Cleanup

```bash
tmux kill-session -t fgac-cli-qa
```
