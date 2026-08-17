# Production: Hosted MCP

> Install: Direct curl against `https://fgac.ai/api/mcp`
> Runs ALL capabilities against production.

## Install

No install needed — direct HTTP access to the hosted MCP endpoint.

```bash
BASE_URL=https://fgac.ai
```

## Auth

1. Register DCR client against production:
   ```bash
   REG_ENDPOINT=$(curl -sf $BASE_URL/.well-known/oauth-authorization-server | jq -r '.registration_endpoint')
   DCR=$(curl -sf $REG_ENDPOINT -X POST -H "Content-Type: application/json" \
     -d '{"client_name":"QA Prod Hosted MCP","redirect_uris":["http://localhost:9999/callback"],"grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none"}')
   ```
2. Complete OAuth via browser agent
3. Approve connection in production dashboard

## Run ALL Capabilities

> **CRITICAL**: Production testing MUST validate full end-to-end plumbing. Do not just verify installation.

Run the *exact same capability checklists* as the local tests, but against the production `fgac.ai` endpoints. Follow the steps in `agents/01_hosted_mcp.md` using `BASE_URL=https://fgac.ai`:

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
