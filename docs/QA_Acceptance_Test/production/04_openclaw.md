# Production: OpenClaw (ClawHub)

> Install: Via `clawhub skill install fgac`
> Runs ALL capabilities against `https://gmail.fgac.ai`

## Install from Distribution Channel

```bash
clawhub skill install fgac
```

### Verify Install
- [ ] Skill installed at `~/.openclaw/skills/fgac/`
- [ ] SKILL.md present with correct production URLs (`gmail.fgac.ai`)
- [ ] Scripts directory contains `gmail.js`, `auth.js`, `accounts.js`

## Auth

```bash
node ~/.openclaw/skills/fgac/scripts/auth.js --action login
```
- [ ] Browser opens to `https://fgac.ai` OAuth consent
- [ ] Token saved to `~/.openclaw/fgac/tokens/`
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
  -d '{"message": "List my recent emails using fgac"}'
```

> **CRITICAL**: Production testing MUST validate full end-to-end plumbing. Do not just verify installation.

Run the *exact same capability checklists* as the local tests, but against the production endpoints. Follow the steps in `agents/04_openclaw.md` (no URL override needed, skill already points to production URLs):

- `[ ]` Execute **Send Whitelist** checklist (→ `capabilities/01_send_whitelist.md`)
- `[ ]` Execute **Read Blacklist** checklist (→ `capabilities/02_read_blacklist.md`)
- `[ ]` Execute **Multi-Email Scoping** checklist (→ `capabilities/03_multi_email_scoping.md`)
- `[ ]` Execute **Delegation** checklist (→ `capabilities/04_delegation.md`)
- `[ ]` Execute **Connection Lifecycle** checklist (→ `capabilities/06_connection_lifecycle.md`)
- `[ ]` Execute **Key Lifecycle** checklist (→ `capabilities/07_key_lifecycle.md`)
- `[ ]` Execute **Label Access** checklist (→ `capabilities/05_label_access.md`)

## Capability: Analytics Events (→ capabilities/16_analytics_events.md)

> Run LAST — it inspects the PostHog events the capabilities above generated.
> Environment tier here is `production` (fgac.ai); this run's events are QA
> noise in prod dashboards — the "Internal / QA" cohort filter covers it.

- A1–A5: query per capability 16 “How to query” — primary: the session's
  PostHog MCP connector (load via ToolSearch keyword `posthog exec`, then
  `execute-sql` HogQL) filtering `properties.environment = 'production'` and the
  run window; fallback: `npx tsx scripts/qa-posthog-events.ts --event
  '$mcp_tool_call' --since <minutes since run start> --environment production`
  (needs the currently-unprovisioned query keys). A2 expects 0 rows for the
  legacy `mcp_tool_call` name. `skip` only if the session has no PostHog
  query path at all. Ingestion lags ~30–60s — re-query before failing.
- A6: via the browser agent, click a sign-up CTA signed-out (never complete
  sign-up), then query `--event sign_up_started`. Headless-only run → `skip`.
- A7: start playback on a landing-page demo video (play control, or the
  console postMessage fallback in the capability doc), then query
  `--event video_played`. Headless-only run → `skip`.
