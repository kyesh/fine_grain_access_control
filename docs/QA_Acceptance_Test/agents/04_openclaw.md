# Agent: OpenClaw (Docker)

> Runs ALL capabilities via a genuine OpenClaw instance in Docker.
> Package #2 from distribution_architecture.md.

## Prerequisites
- `/qa-setup` completed (keys, rules, emails configured)
- Dev server running at `http://localhost:3000`
- Docker installed
- `openclaw:local` image built (from demoClaw or OpenClaw repo)

## Auth Setup

1. Start TestClaw container:
   ```bash
   cd test/testclaw
   docker compose up -d
   ```
2. Wait for OpenClaw gateway:
   ```bash
   until curl -sf http://localhost:18789/health; do sleep 2; done
   ```
3. Run OAuth via the gateway (or pre-provision credentials):
   ```bash
   # If using pre-provisioned credentials:
   docker exec testclaw-testclaw-1 \
     FGAC_ROOT_URL=http://localhost:3000 \
     node /home/node/.openclaw/skills/gmail-fgac/scripts/auth.js --action login
   ```
4. Complete OAuth flow via browser agent
5. Approve connection in dashboard

## Proof of Authenticity

> The following evidence proves the **real OpenClaw agent** processes requests:

- [ ] Docker container logs show gateway receiving the chat prompt:
      `docker logs testclaw-testclaw-1 2>&1 | grep -i "gmail-fgac"`
- [ ] Logs show skill discovery and invocation (not direct script execution)
- [ ] Prompts sent to `http://localhost:18789/api/chat` (gateway API), NOT to `node gmail.js`

---

## Capability: Send Whitelist (→ capabilities/01_send_whitelist.md)

### A1: Send to whitelisted address
```bash
curl -X POST http://localhost:18789/api/chat \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Send an email to '$USER_B_EMAIL' with subject QA OpenClaw - Send Whitelist A1 and body Test from OpenClaw using the gmail-fgac skill"}'
```
- [ ] OpenClaw discovers gmail-fgac skill, invokes `gmail.js --action send`
- [ ] Email sent successfully

### A2: Send to blocked address
```bash
curl -X POST http://localhost:18789/api/chat \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Send an email to blocked@untrusted.com with subject Blocked using gmail-fgac"}'
```
- [ ] OpenClaw reports whitelist error from skill output
- [ ] Agent does not crash — handles error gracefully

---

## Capability: Read Blacklist (→ capabilities/02_read_blacklist.md)

### A4: Read normal email
```bash
curl -X POST http://localhost:18789/api/chat \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "List my recent emails using gmail-fgac"}'
```
- [ ] OpenClaw invokes `gmail.js --action list`, returns emails

---

## Capability: Multi-Email Scoping (→ capabilities/03_multi_email_scoping.md)

### A1: List accounts
```bash
curl -X POST http://localhost:18789/api/chat \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What email accounts can I access via gmail-fgac?"}'
```
- [ ] OpenClaw invokes `accounts.js --action list`
- [ ] Returns mapped email accounts

---

## Capability: Delegation (→ capabilities/04_delegation.md)

### A6: List accounts shows delegated
- [ ] accounts.js returns both own and delegated emails through gateway

---

## Capability: Connection Lifecycle (→ capabilities/06_connection_lifecycle.md)

### A3-A5: Tested during auth setup
- [ ] OAuth → pending → approved → tools work through gateway

---

## Capability: Key Lifecycle (→ capabilities/07_key_lifecycle.md)

### A1: After key revocation
- [ ] Gateway returns auth error when skill tries to use revoked key

---

## Capability: Label Access (→ capabilities/05_label_access.md)

- [ ] Label rules enforced when reading via gateway

---

## Capability: Light Mode (→ capabilities/08_strict_light_mode.md)

> Tested via browser agent — same for all agents.

---

## Cleanup

```bash
docker compose -f test/testclaw/docker-compose.yml down
```
