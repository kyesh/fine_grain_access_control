# PostHog canonical MCP events + analytics QA capability — v1

Branch: `claude/gifted-bhaskara-861ce8`

## Problem

Our custom `mcp_tool_call` event name collides with the event PostHog's
archived beta MCP SDK once emitted, so the PostHog UI shows it as
"MCP tool call (legacy)" and its MCP Analytics views resolve no tool name
(they read `$mcp_tool_name`; ours was `tool`). Nothing was lost — the data
was always there under custom properties — but the built-in views were blank
and the naming was on borrowed ground.

## Plan

1. **Rename to PostHog's canonical MCP Analytics schema** in the
   `withToolAnalytics` wrapper (`src/app/api/mcp/route.ts`):
   `$mcp_tool_call` with `$mcp_tool_name`, `$mcp_duration_ms`,
   `$mcp_is_error` (true only for `error`/`exception` outcomes), keeping the
   FGAC-specific `outcome` taxonomy and `client_id` as custom properties.
   Deliberately NOT adopting `@posthog/mcp` / the mcp-analytics wizard: it
   captures `$mcp_parameters`/`$mcp_response` (customer mail content) with no
   redaction option, and doesn't support our per-request Clerk distinct id.
2. **Docs**: update `docs/analytics.md` event catalog (rename + previously
   undocumented `mcp_connection_created`, `approval_link_minted`,
   `read_restriction_enforced`), record the legacy-name history and the
   no-payload-capture policy.
3. **QA capability 16** (`docs/QA_Acceptance_Test/capabilities/16_analytics_events.md`):
   six assertions — canonical events arrive with tool names, zero legacy-named
   events, outcome taxonomy present, Clerk-user attribution, environment
   tagging, sign-up CTA event. Sections appended to all 8 agent/production
   runbooks (run LAST, after the run has generated tool calls).
4. **Query tooling**: `scripts/qa-posthog-events.ts` — read-only HogQL probe
   (masked distinct ids, summary counts). Needs `POSTHOG_PERSONAL_API_KEY`
   (Query:Read) + `POSTHOG_PROJECT_ID`; assertions skip (never pass) without
   them. `.mcp.json` adds the hosted PostHog MCP server keyed off the same
   env var as an alternative query path.

## Validation

- `npx tsc --noEmit` clean; eslint clean on changed files (repo has
  pre-existing unrelated errors).
- Script smoke-tested: clean exit 2 + guidance without creds; input
  validation on `--event`/`--since`/`--environment`.
- Live validation (events visible end-to-end) requires the user to provision
  the PostHog personal API key + project id, then run capability 16 against
  local dev and the PR preview.
