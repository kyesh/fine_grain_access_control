# Raw Google API Classification + Attachment Instrumentation Port — v2

Revision of v1 (see `raw-api-classification_v1.md` for the original scope, all
of which shipped and was QA-validated on the PR #78 preview on 2026-08-21).

## v2 addendum: PostHog QA verification path (Ken's decision, 2026-08-23)

The v1 validation plan assumed `scripts/qa-posthog-events.ts` for capability
16's event-side assertions; its `POSTHOG_PERSONAL_API_KEY` /
`POSTHOG_PROJECT_ID` turned out to be unprovisioned everywhere (Vercel envs and
both clones). Of the two remedies —

1. provision the keys in the Vercel dev env (script stays primary), or
2. grant QA runner subagents access to the session's PostHog MCP connector,

— Ken chose **option 2**: keys stay deliberately unprovisioned. Verified
empirically that subagents inherit the session's MCP connections and can load
the exec tool via ToolSearch.

Changes:

- `.claude/agents/qa-env-runner.md`: `ToolSearch` and the PostHog exec tool
  added to the frontmatter allowlist; new procedure block telling runners to
  discover the tool by ToolSearch keyword (`posthog exec` — the tool-name
  prefix is a connector UUID, never hardcode it), filter
  `properties.environment` + run window, cite "via PostHog MCP" in evidence,
  and `skip` event assertions only when the session has no PostHog path at all
  (cloud/CI without the connector).
- `docs/QA_Acceptance_Test/capabilities/16_analytics_events.md` "How to
  query": MCP connector promoted to primary; the script demoted to fallback
  with a note that its keys are deliberately unprovisioned.
- All 8 environment runbooks (`agents/01–04`, `production/01–04`): the
  capability-16 A1–A5 instruction block rewritten to point at capability 16's
  query section (MCP primary, script fallback), tier filter preserved;
  `agents/01` capability-17 A8 event check reworded to match.
