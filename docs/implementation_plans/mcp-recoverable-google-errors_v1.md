# Recoverable Google Errors — non-error MCP results (v1)

Branch: `claude/mcp-recoverable-google-errors` · Date: 2026-08-17
Follow-up to: `connector-approval-audit_v2.md` Q1 (error handling protects the
directory health metric) and the 2026-08-16 QA-harness directory audit.

## Problem

The connectors directory health metric counts request-level 4xx/5xx and tool
results with `isError: true`. FGAC policy denials were already returned as
success-shaped `textResult`s (`🚫`/`⏳` prefixes), but **every** upstream Google
failure went through `errorResult` (`isError: true`) — including states only
the user can fix and that our own UX treats as normal flows:

- Google 401: the user's Google grant expired or was revoked → "reconnect".
- Google 403: a spreadsheet not shared with the connected account, or a
  missing OAuth scope → "share the sheet / re-grant". This is exactly the
  add-a-sheet-you-haven't-granted-us flow being built — its guidance messages
  must not read as connector malfunctions.
- Google 404: wrong resource id → "check the id".

Inconsistency aside (a dead Google grant detected at token-fetch time was
already a non-error `textResult`, but detected at request time it was
`isError`), these are the connector guiding the user, not failing.

## Change (src/app/api/mcp/route.ts)

1. `GoogleFetchResult` failure arm gains `recoverable: boolean`;
   `RECOVERABLE_GOOGLE_STATUSES = {401, 403, 404}`. Network errors, 429, and
   5xx stay non-recoverable.
2. New `upstreamResult` helper: recoverable → `textResult` (leading `❌`,
   PostHog outcome `failed`); non-recoverable → `errorResult` (`isError`,
   outcome `error`). All upstream-failure call sites route through it.
3. 403 message enriched with the actionable fix: share the spreadsheet with
   the connected account, or reconnect Google to grant scopes.

## Non-changes / invariants

- Policy denials, pending-approval, and magic-link flows: untouched.
- PostHog `$mcp_tool_call` outcome taxonomy: unchanged set (capability 16 A3
  still holds); recoverable upstream failures move from `error` to `failed`.
- Protocol-level auth (HTTP 401 on expired FGAC OAuth tokens): untouched —
  required by the MCP/OAuth spec.
- The REST proxy route is out of scope (not a directory metrics surface).

## Validation

- `npx tsc --noEmit` + `npm run lint` (includes `mcp:lint`).
- Targeted QA: sheets management / raw Google API capabilities exercise the
  403/404 paths; full re-run not required for this change per QA impact.
