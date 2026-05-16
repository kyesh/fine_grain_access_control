# Production: Claude Code CLI (SKILL.md Option B)

> Install: Copy scripts per SKILL.md Option B instructions
> Runs ALL capabilities against `https://gmail.fgac.ai`

## Install from Distribution Channel

Follow SKILL.md Option B (local scripts):

```bash
# Copy skill to Claude Code skills directory
cp -r docs/skills/gmail-fgac ~/.config/claude/skills/gmail-fgac
```

Or per SKILL.md Getting Started:
```bash
# 1. Clone or download the skill
# 2. Place credentials in tokens directory
```

### Verify Install
- [ ] Scripts exist at expected path
- [ ] `node ~/.config/claude/skills/gmail-fgac/scripts/gmail.js --help` works

## Auth

```bash
node ~/.config/claude/skills/gmail-fgac/scripts/auth.js --action login
```
- [ ] Browser opens to `https://fgac.ai` OAuth consent
- [ ] Token saved locally after consent
- [ ] Connection approved in production dashboard

## Run ALL Capabilities

Follow `agents/03_claude_code_cli.md` — scripts already point to production URLs (no override).

- [ ] Send whitelist: allowed send, blocked send
- [ ] Read blacklist: normal read
- [ ] Multi-email scoping: accounts.js shows correct emails
- [ ] Connection lifecycle: auth → approve → tools work
