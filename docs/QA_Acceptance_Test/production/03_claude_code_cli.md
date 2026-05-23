# Production: Claude Code CLI (Marketplace Bundle)

> Install: Via Claude Code plugin marketplace
> Runs ALL capabilities against `https://gmail.fgac.ai`

> **Note**: This production channel is currently blocked pending the availability of the skill bundle in the marketplace.

## Install from Distribution Channel

Install the skill bundle from the Claude Code marketplace (simulated or real).
Once installed, the `SKILL.md` and scripts should be present in the local `.claude/skills/gmail-fgac` directory.

### Verify Install
- `[ ]` `node .claude/skills/gmail-fgac/scripts/gmail.js --help` works

## Auth

```bash
node .claude/skills/gmail-fgac/scripts/auth.js --action login
```
- `[ ]` Browser opens to `https://fgac.ai` OAuth consent
- `[ ]` Token saved locally after consent
- `[ ]` Connection approved in production dashboard

## Run ALL Capabilities

> **CRITICAL**: Production testing MUST validate full end-to-end plumbing. Do not just verify installation.

Run the *exact same capability checklists* as the local tests, but against the production endpoints. Follow the steps in `agents/03_claude_code_cli.md` (no URL override needed, scripts default to production):

- `[ ]` Execute **Send Whitelist** checklist (→ `capabilities/01_send_whitelist.md`)
- `[ ]` Execute **Read Blacklist** checklist (→ `capabilities/02_read_blacklist.md`)
- `[ ]` Execute **Multi-Email Scoping** checklist (→ `capabilities/03_multi_email_scoping.md`)
- `[ ]` Execute **Delegation** checklist (→ `capabilities/04_delegation.md`)
- `[ ]` Execute **Connection Lifecycle** checklist (→ `capabilities/06_connection_lifecycle.md`)
- `[ ]` Execute **Key Lifecycle** checklist (→ `capabilities/07_key_lifecycle.md`)
- `[ ]` Execute **Label Access** checklist (→ `capabilities/05_label_access.md`)
