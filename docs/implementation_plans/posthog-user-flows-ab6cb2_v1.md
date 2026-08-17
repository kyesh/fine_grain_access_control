# Delegation Observability Instrumentation + Daily Analytics Routine

Branch: `claude/posthog-user-flows-ab6cb2`

## Problem

PostHog analysis (2026-08-16) showed the product's server events could not answer
"which Google account did this call touch?" — `mcp_tool_call` carried only
`tool`/`outcome`/`client_id`, `proxy_request` only `service`/`status`/`proxy_key_id`.
That makes delegation usage (one user accessing N mailboxes) invisible, and it blocks a
scheduled daily-review agent from modeling multi-account users. The delegation *graph*
lives in Neon (`email_delegations`, `key_email_access`), but a cloud analytics agent
should not hold production DB credentials — so the app must emit the needed facts to
PostHog at event time.

## Changes

1. **`src/lib/toolCallContext.ts` (new)** — AsyncLocalStorage bag so per-call facts
   discovered deep in a tool (account resolution) reach the single `mcp_tool_call`
   capture in the generic `withToolAnalytics` wrapper without changing tool signatures.
2. **`src/app/api/mcp/route.ts`** — wrapper runs each tool inside
   `runWithToolCallProps` and spreads `getToolCallProps()` into the capture;
   `resolveAccountAndToken` adds `account_email` + `account_delegated`
   (`!!access.delegationId`) once key↔email access is confirmed.
3. **`src/app/api/proxy/[...path]/route.ts`** — `ProxyTelemetry` gains
   `targetEmail`/`accountDelegated`; set in the Gmail handler from the matched
   `key_email_access` row and in the Sheets handler (always the owner's own account);
   `proxy_request` capture now carries `account_email` + `account_delegated`.
4. **`src/app/dashboard/actions.ts`** — new events: `delegation_created`
   (`delegate_email`, `reactivated`) in `createDelegation`, and `account_linked`
   (`target_email`, `delegated`, `via: 'create_key'`) per email in `createProxyKey`.

Not instrumented (deliberate): `rollProxyKey` (copies existing grants, not a new link),
`ensureDefaultProfile` (own-mailbox auto-attach is already implied by
`mcp_connection_created` with `auto_attached`).

## Downstream consumer

A claude.ai cloud routine (2× daily) queries PostHog and reports usage trends,
stuck-points, and churn signals, using `account_email`/`account_delegated` to count
distinct mailboxes per user. Until this change deploys, the routine reports the
instrumentation gap instead of per-account numbers.

## Validation

- `npx tsc --noEmit` clean.
- No schema/DB changes; no migration needed.
- Event property names verified against existing PostHog taxonomy (no collisions).
