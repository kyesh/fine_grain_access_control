# Production: OpenClaw (ClawHub)

> Install: Via `clawhub skill install gmail-fgac`
> Runs ALL capabilities against `https://gmail.fgac.ai`

## Install from Distribution Channel

```bash
clawhub skill install gmail-fgac
```

### Verify Install
- [ ] Skill installed at `~/.openclaw/skills/gmail-fgac/`
- [ ] SKILL.md present with correct production URLs (`gmail.fgac.ai`)
- [ ] Scripts directory contains `gmail.js`, `auth.js`, `accounts.js`

## Auth

```bash
node ~/.openclaw/skills/gmail-fgac/scripts/auth.js --action login
```
- [ ] Browser opens to `https://fgac.ai` OAuth consent
- [ ] Token saved to `~/.openclaw/gmail-fgac/tokens/`
- [ ] Connection approved in production dashboard

## Run ALL Capabilities

Start OpenClaw and test through the gateway:

```bash
# Start OpenClaw gateway
openclaw gateway --port 18789

# Send prompts through the gateway
curl -X POST http://localhost:18789/api/chat \
  -H "Authorization: Bearer $GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "List my recent emails using gmail-fgac"}'
```

Follow `agents/04_openclaw.md` — skill already points to production URLs.

- [ ] OpenClaw discovers skill installed from ClawHub
- [ ] Send whitelist: allowed send, blocked send
- [ ] Read blacklist: normal read
- [ ] Multi-email scoping: accounts.js shows correct emails
- [ ] Connection lifecycle: auth → approve → tools work
