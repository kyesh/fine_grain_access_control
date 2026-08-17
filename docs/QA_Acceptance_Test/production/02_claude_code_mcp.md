# Production: Claude Code MCP (Plugin Marketplace)

> **GATED — user-confirmed production QA only.** Do not execute this runbook
> unless the dispatching prompt states the user explicitly confirmed production
> QA in the current session (see `/qa-production`). If that sentence is absent,
> stop and report instead of running. This suite mutates the shared production
> QA account and deliberately triggers denials against production endpoints.


> Install: Via Claude Code plugin marketplace or `claude mcp add`
> Runs ALL capabilities against `https://fgac.ai/api/mcp`

## Install from Distribution Channel

### Option A: Plugin Marketplace
```
/plugin marketplace browse
```
Search for "fgac" → Install

### Option B: Manual MCP Add
```bash
claude mcp add --transport http fgac https://fgac.ai/api/mcp
```

### Verify Install
```bash
claude mcp list
```
- [ ] `fgac` listed with URL `https://fgac.ai/api/mcp`

## Auth

1. Start Claude Code in tmux
2. `/mcp` → select `fgac` → Authenticate
3. Complete OAuth flow via browser → consent → approve in production dashboard

## Run ALL Capabilities

> **CRITICAL**: Production testing MUST validate full end-to-end plumbing. Do not just verify installation.

Run the *exact same capability checklists* as the local tests, but against the production endpoints. Follow the steps in `agents/02_claude_code_mcp.md` (no URL override needed, MCP already points to production):

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

- A1–A5: `npx tsx scripts/qa-posthog-events.ts --event '$mcp_tool_call' --since <minutes since run start> --environment production`
  (A2 repeats with `--event mcp_tool_call` expecting 0 rows). Needs
  `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID`; if unset, `skip` all with
  that reason. Ingestion lags ~30–60s — re-query before failing.
- A6: via the browser agent, click a sign-up CTA signed-out (never complete
  sign-up), then query `--event sign_up_started`. Headless-only run → `skip`.
- A7: start playback on a landing-page demo video (play control, or the
  console postMessage fallback in the capability doc), then query
  `--event video_played`. Headless-only run → `skip`.
