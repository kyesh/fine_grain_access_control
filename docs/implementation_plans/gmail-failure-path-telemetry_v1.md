# Gmail post-policy failure path: telemetry then copy

Branch: `claude/distracted-germain-3d9e18` · Plan v1 · 2026-08-26

## Problem

The 2026-08-26 analytics review found Gmail is the worst-performing tool
surface (`gmail_get_attachment` 49.1% err, `gmail_list` 12.9%). Every failure
mode traces to one mechanism: `describeGoogleError` (`route.ts:470`) collapses
every Google failure into one generic remediation per HTTP status, and the
alternative path (`textResult('❌ …')`) carries no structured status at all.
The sheets/docs path already solved this with `fileGrantErrorResult`
(`route.ts:528`); Gmail never got the equivalent.

## Verification status (read this before trusting any number)

**The production figures in the task brief could NOT be re-verified in this
session.** All three PostHog query paths are blocked:

| path | requirement | state |
| --- | --- | --- |
| claude.ai PostHog connector | installed connector | absent this session (`list_connectors` → none) |
| `posthog` MCP (`.mcp.json`) | `POSTHOG_PERSONAL_API_KEY` in shell env | unset |
| `scripts/qa-posthog-events.ts` | same key in `.env.local` | absent after `vercel env pull` |

`npm run env:check` reports this exact gap. Provisioning the `phx_…` key is a
user action in the PostHog UI. **Consequence for this plan:** no change below
is justified by a measured rate. Every change is justified either by a
code-established cause (a branch that provably conflates two conditions) or by
being a pure observability addition that is correct regardless of what the
distribution turns out to be. The one genuinely data-dependent decision —
how to word the 403 remediation for each reason — is handled by branching on
the reason Google itself returns, so it needs no prior distribution.

## Established causes (from code, not from data)

### C1. `case 403` asserts one cause for a status Google uses for many

`route.ts:477` returns "Google's grant for '<email>' is missing a scope or was
revoked — retrying will NOT fix it. Ask the user to reconnect the account".
Google returns 403 for `insufficientPermissions`, but also for
`rateLimitExceeded` / `userRateLimitExceeded` / `dailyLimitExceeded` (domain
`usageLimits`) and `domainPolicy`. For a rate-limited caller this text is
actively harmful: it tells the user to tear down a *working* Google
connection, and it suppresses the retry that would have succeeded. This is a
correctness defect independent of how often each reason occurs.

The distinguishing field — `error.errors[0].reason` / `error.errors[0].domain`
/ `error.status` — is present in the parsed body at `route.ts:459-465` and is
discarded; only the numeric status survives.

### C2. `gmail_get_attachment` conflates two different 404s

The handler makes **two** `gmailFetch` calls (`route.ts:1234`+):

1. `messages/{messageId}?format=full` — the parent-message read.
2. `messages/{messageId}/attachments/{attachmentId}` — the attachment read.

Both funnel into the same generic "Google resource not found (404). Check the
ID and try again." An agent receiving it cannot tell **which of the two ids is
bad**, so "check the ID" is unactionable — which is the documented cause of
the retry loop that `fileGrantErrorResult` was written to stop for sheets.

This is separable with certainty and with no new data: if call 1 **succeeded**
and call 2 404s, the `messageId` is provably valid and the `attachmentId` is
the bad one. Gmail attachment ids are message-scoped (they are a path segment
under the message) and are re-issued when a message is re-indexed, so the
correct recovery is to re-run `gmail_read` on the *same* `messageId` and take
a fresh `attachmentId` — a remediation that is only correct in this branch.
If call 1 404s, the `messageId` itself is wrong and that advice would be
wrong.

### C3. `resolveAccountAndToken`'s four failures are an analytics dead end

`route.ts:896` has four failure returns (no proxy key / no accessible accounts
/ key lacks access to this email / token fetch failed). Every caller does
`return textResult(resolved.error)` with no `addToolCallProps`, so the branch
that fired is unrecoverable. These are the `outcome='failed'` class.

## Design decisions

**D1. Do not convert these `textResult`s to `errorResult`.** `route.ts:862`
sets `$mcp_is_error: outcome === 'error' || outcome === 'exception'` — so
`outcome='failed'` is currently **not** an error in the field Anthropic's
Connector Directory reads. Converting would import ~45 calls/week into our
public error rate purely to improve our own telemetry. A separate property
gets the same visibility at no external cost.

**D2. New property `failure_reason`, distinct from `error_status`.**
`error_status` means "Google returned this HTTP status". The
`resolveAccountAndToken` branches never reached Google. Overloading
`error_status` would corrupt the existing series.

**D3. Ship instrumentation with the copy, not after it.** `error_reason` is
what makes the 403 branching possible at all, so they are one change.

## Changes

### P1 — Instrumentation

- **P1a** `googleFetch` (`route.ts:~504`): parse `error.errors[0].reason`,
  `error.errors[0].domain`, `error.status` from the already-parsed body;
  stamp `error_reason` (and `error_domain` when present) alongside
  `error_status`. Pass the extracted reason into `describeGoogleError`.
  These are Google-defined enum-ish strings, not customer data.
- **P1b** `resolveAccountAndToken`: stamp `failure_reason` with one of
  `no_proxy_key` / `no_accessible_accounts` / `account_not_permitted` /
  `google_token_unavailable` on the four branches. Response text and
  `isError` unchanged (D1).

### P2 — Copy grounded in C1/C2

- **P2a** `describeGoogleError` `case 403` branches on reason:
  - `usageLimits` domain or `*rateLimitExceeded` / `quotaExceeded` →
    wait-and-retry (the `case 429` text at `:483` is already right).
  - `insufficientPermissions` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT` → the
    existing reconnect text, which is correct *here*.
  - `domainPolicy` → Workspace admin policy; reconnecting will not help.
  - unknown/absent reason → hedged text that states the two likely causes
    and does **not** assert "retrying will NOT fix it".
- **P2b** `gmail_get_attachment`: distinct 404 remediation per call site.
  Parent 404 → the `messageId` is wrong or the message was deleted; re-run
  `gmail_list` — do not retry this pair. Attachment 404 → the `messageId` is
  valid, the `attachmentId` is stale/wrong; re-run `gmail_read` on the same
  `messageId`, take a fresh id from `attachments`, retry **once**, and stop if
  it fails again. Every branch carries an explicit stop condition — the
  9-calls-in-one-day signature says the missing piece is the stop, not the
  explanation.
- **P2c** `gmail_read`'s `attachments` entries and the `attachmentId` tool
  description note that ids are message-scoped and can be re-issued, so a
  stored id must not be reused across sessions.

### P3 — Docs

`docs/analytics.md`: add `error_reason` / `error_domain` / `failure_reason` to
the `$mcp_tool_call` row and the failure-detail section, including the D1
rationale so a later change doesn't "tidy" these into `errorResult`.

## Out of scope

Approval links, policy denials, the sheets access gate (PR #87 owns the
approval funnel). The 200 KB attachment cap — PR #86 already reclassified it
as `size_capped` and it accounts for 3 calls, so it is not the driver.

## Validation

1. `npm run typecheck` / `lint` / `build`.
2. Unit-level: exercise `describeGoogleError` across the 403 reason matrix and
   both 404 sites.
3. Preview deploy via `/deploy-pr-preview`, then the Gmail QA capabilities.
4. **Post-merge, once the PostHog key exists**: confirm `error_reason` is
   populated on 403s and read the real `insufficientPermissions` vs
   `usageLimits` split. That split is the thing this plan could not establish;
   it decides whether further 403 work is warranted.
