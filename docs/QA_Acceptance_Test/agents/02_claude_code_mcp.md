# Agent: Claude Code MCP

> Runs ALL capabilities via Claude Code MCP in a tmux session.
> Package #3 from distribution_architecture.md.

## Prerequisites
- `/qa-setup` completed (keys, rules, emails configured)
- Dev server running at `http://localhost:3000`
- `fgac-gmail` configured in `.claude.json` pointing to `http://localhost:3000/api/mcp`
- `tmux` installed
- Chrome running with remote debugging at `localhost:9222` (for auto-consent)

## Auth Setup

1. Start Claude Code in tmux:
   ```bash
   tmux new-session -d -s fgac-qa -x 200 -y 50 "claude --dangerously-skip-permissions"
   ```
2. Wait for Claude Code prompt:
   ```bash
   # Poll until ready
   until tmux capture-pane -t fgac-qa -p | grep -q '❯'; do sleep 2; done
   ```
3. Start MCP auth:
   ```bash
   tmux send-keys -t fgac-qa "/mcp" Enter
   # Select fgac-gmail → Authenticate
   ```
4. Extract auth URL from tmux output:
   ```bash
   AUTH_URL=$(tmux capture-pane -t fgac-qa -p -S -50 | grep -o 'http[s]*://[^ ]*auth[^ ]*')
   ```
5. Auto-consent via playwright:
   ```bash
   npx @playwright/cli -s=antigravity_ui goto "$AUTH_URL"
   # Wait for and click "Allow" button
   ```
6. Verify authentication:
   ```bash
   tmux capture-pane -t fgac-qa -p | grep "Authentication successful"
   ```
7. Approve connection in dashboard via `/browser-agent`

## Proof of Authenticity

> The following evidence proves Claude Code (not a script) processes requests:

- [ ] `tmux capture-pane` output shows Claude Code's TUI rendering the tool call
- [ ] Screenshot of Claude Code session showing `fgac-gmail` tool invocation
- [ ] Output is from Claude's natural language processing, not a raw `node gmail.js` call

---

## Capability: Send Whitelist (→ capabilities/01_send_whitelist.md)

### A1: Send to whitelisted address
```bash
tmux send-keys -t fgac-qa "Send an email to $USER_B_EMAIL with subject 'QA CC MCP - Send Whitelist A1' and body 'Test from Claude Code MCP'" Enter
```
- [ ] Claude Code invokes `gmail_send`, email sent successfully

### A2: Send to blocked address
```bash
tmux send-keys -t fgac-qa "Send an email to blocked@untrusted.com with subject 'Blocked'" Enter
```
- [ ] Claude Code reports whitelist error from fgac-gmail

---

## Capability: Read Blacklist (→ capabilities/02_read_blacklist.md)

### A1: Read blacklisted email
```bash
tmux send-keys -t fgac-qa "Read the email from sales@competitor.com" Enter
```
- [ ] Claude Code reports "Access restricted" error

### A4: Read normal email
```bash
tmux send-keys -t fgac-qa "List my recent emails" Enter
```
- [ ] Claude Code returns email list via `gmail_list`

---

## Capability: Multi-Email Scoping (→ capabilities/03_multi_email_scoping.md)

### A1: List accounts
```bash
tmux send-keys -t fgac-qa "What email accounts can I access?" Enter
```
- [ ] Shows correct email accounts for this proxy key

---

## Capability: Delegation (→ capabilities/04_delegation.md)

### A6: List accounts shows delegated
```bash
tmux send-keys -t fgac-qa "List my email accounts" Enter
```
- [ ] Shows both own and delegated emails (if delegation configured)

---

## Capability: Connection Lifecycle (→ capabilities/06_connection_lifecycle.md)

### A3-A5: Tested during auth setup above
- [ ] Pending connection created during OAuth
- [ ] Approved in dashboard
- [ ] Tools work after approval

### A6: get_my_permissions
```bash
tmux send-keys -t fgac-qa "What are my permissions?" Enter
```
- [ ] Shows connection, key, emails, rules

---

## Capability: Label Access (→ capabilities/05_label_access.md)

```bash
tmux send-keys -t fgac-qa "Read the email labeled Highly-Confidential" Enter
```
- [ ] Blocked by label blacklist (if configured)

---

## Capability: Key Lifecycle (→ capabilities/07_key_lifecycle.md)

> Key revocation tested by revoking key in dashboard, then retrying:
```bash
tmux send-keys -t fgac-qa "List my emails" Enter
```
- [ ] Returns error after key revocation

---

## Capability: Light Mode (→ capabilities/08_strict_light_mode.md)

> Tested via browser agent — same for all agents. See capability doc.

---

## Cleanup

```bash
tmux kill-session -t fgac-qa
```
