# Product Analytics (PostHog)

How FGAC.ai instruments usage, how PostHog persons map to Clerk users, and how to
keep internal/QA traffic out of the numbers.

## Identity model

- **Distinct id = Clerk user id, everywhere.** The dashboard calls
  `posthog.identify(clerkUserId)` on sign-in (`src/app/PostHogIdentify.tsx`); the
  MCP server, API proxy, and Clerk webhook capture server-side events with the
  same id (`src/lib/posthogServer.ts`). One PostHog person per Clerk user, with
  `email`/`name` person properties.
- Signed-out visitors stay anonymous (`person_profiles: 'identified_only'`).
  `posthog.reset()` runs on sign-out so shared browsers don't cross-link users.
- **`signup_source` person property** (`$set_once`): fresh accounts (<10 min
  old) are stamped `website` on their first identified dashboard visit
  (`PostHogIdentify`) or `claude_connector` on their first MCP connection —
  whichever touchpoint a new account reaches first wins.
- **Delegation observability**: tool/proxy events carry `account_email` and
  `account_delegated` (which mailbox a call resolved to, own vs delegated) via
  `src/lib/toolCallContext.ts` (AsyncLocalStorage rides the props from account
  resolution to the single capture site).

## Event catalog

| Event | Source | Key properties |
| --- | --- | --- |
| `$pageview` | client (`PostHogPageView.tsx`) | `$current_url` |
| `sign_up_started` | client (`SignUpCta.tsx`, all sign-up CTAs) | `cta_location`: nav / hero / bottom_cta |
| `sign_up_completed` | server (Clerk webhook, `user.created`) | `$set.email` |
| `video_played` | client (`TrackedVideoEmbed.tsx`, all Descript demo embeds) | `video_id`, `video_title`, `page` |
| `$mcp_tool_call` | server (`/api/mcp`, every tool) | `$mcp_tool_name`, `$mcp_duration_ms`, `$mcp_is_error`, `client_id`, `outcome`, `account_email`, `account_delegated` |
| `proxy_request` | server (`/api/proxy/[...path]`) | `service` (gmail/sheets/drive), `method`, `status`, `outcome`, `duration_ms`, `proxy_key_id`, `account_email`, `account_delegated` |
| `mcp_connection_created` | server (`/api/mcp` auth layer) | `connection_id`, `client_id`, `auto_attached`, `account_age_seconds` |
| `delegation_created` | server (dashboard action) | `delegate_email`, `reactivated` |
| `account_linked` | server (dashboard action) | `target_email`, `delegated`, `via` |
| `approval_link_minted` | server (`/api/mcp`) | `action` |
| `read_restriction_enforced` | server (`/api/mcp`) | `via` (tool name), `restriction` |
| `sheets_grant_verification` | server (approve-page load via `/api/rules/verify-sheets-access`, and approval in `actions.ts`) | `result` (`ok`/`missing`/`unknown`), `via` (`link_open`/`magic_link`/`post_approval`), `spreadsheet_id` |
| `sheets_grant_recovered` | server (`/api/rules/verify-sheets-access`) | `spreadsheet_id` |
| `docs_grant_verification` / `docs_grant_recovered` | server (`/api/rules/verify-docs-access`, approval in `actions.ts`) | docs twins of the sheets grant-funnel events, with `document_id` |
| `agent_doc_created` | server (`/api/mcp`, raw `POST v1/documents`) | `document_id`, `auto_granted` (docs twin of `agent_sheet_created`) |
| `connector_install_started` | server (`.well-known` OAuth discovery routes, `/api/mcp` auth layer) | `touchpoint` (`oauth_discovery`/`mcp_401`), `endpoint`, `reason` (`no_token`/`invalid_token`), `method`, `user_agent` |

The two `sheets_grant_*` events instrument the **picker-first sheets
approval funnel**: opening a sheets approval link verifies the Google-side
`drive.file` grant (`via=link_open`); `result=missing` puts the Picker +
demo-video step BEFORE the approve button, and the approval itself re-fires
with `via=magic_link`. Picking a different sheet than the agent asked for is
an explicit substitution — `approval_link_approved` then carries
`substituted: true` and `granted_count`, making wrong-agent-id frequency
measurable. `/dashboard/sheets-setup` remains the recovery path for
pre-existing stranded rules (dashboard chips, MCP error links); a verified
re-check there fires `sheets_grant_recovered`. Funnel health =
`link_open{missing}` → `magic_link{ok}` conversion.

`$mcp_tool_call` uses PostHog's **canonical MCP Analytics schema** (event and
`$mcp_*` property names) so PostHog's built-in MCP views resolve the tool name.
`$mcp_is_error` is true only for upstream failures/exceptions; the finer-grained
FGAC story is in the custom `outcome` property: `success`, `denied_by_policy`
(🚫 FGAC rule), `pending_approval` (⏳ connection not yet approved), `failed`
(❌ auth/input problems), `error` (upstream Google failure), `exception`.
Unauthenticated calls attribute to the `anonymous-mcp` / `anonymous-proxy` persons.

> **Legacy naming (before 2026-08):** tool calls were captured as a custom
> `mcp_tool_call` event with `tool` / `duration_ms` properties. That name
> collides with the event PostHog's archived beta MCP SDK once emitted, so the
> PostHog UI labels it "MCP tool call (legacy)" and its MCP views show no tool
> name (they read `$mcp_tool_name`). The old events still exist under the old
> name — insights spanning the rename must query both. Nothing in this codebase
> should ever emit `mcp_tool_call` again; QA capability 16 asserts this.

**Failure detail (2026-08 grant-race fixes):** every non-OK Google response
adds `error_status` (HTTP status, or `network`) to the `$mcp_tool_call` event.
Sheets failures whose matching FGAC rule is fresh also carry
`sheets_grant_age_seconds`, and when the post-approval grace retry engaged,
`sheets_grace_retries` + `sheets_grace_recovered` — `recovered=true` volume is
the direct measure of how often the drive.file propagation race would have
surfaced an error to an agent. Google Docs calls carry the same trio under
`docs_grant_age_seconds` / `docs_grace_retries` / `docs_grace_recovered`.

**Response-size monitoring (google-docs-support plan v5, D7 — monitoring
only, no caps):** every `$mcp_tool_call` event carries `response_chars` and
`response_kb`, the serialized size of the tool result FGAC returned. MCP
clients impose their own tool-result budgets (Claude Code rejects results
over ~25k tokens), so a server-side "success" can be silently discarded
client-side. The confirmation question these props exist to answer: what
fraction of successful reads exceed ~25k tokens' worth of chars for
`client_name`-identified Claude Code connections, and do those calls
correlate with abandoned tool sequences? If material, per-kind caps with
recovery guidance get built (Phase 6 of the plan) with thresholds calibrated
from this distribution. `gmail_get_attachment` keeps its historical
`attachment_chars`/`attachment_kb` alongside the generic props; its
pre-existing 200k-char cap is unchanged.

**`connector_install_started` is a rate metric, not an identity metric.** It
fires anonymously (distinct_id `anonymous-mcp`) from the only FGAC-owned
touchpoints that exist before a Clerk account: the OAuth discovery endpoints
(`touchpoint=oauth_discovery`, recurs on reconnects) and unauthenticated MCP
requests (`touchpoint=mcp_401`; `reason=no_token` on POST ≈ fresh install
attempts, `invalid_token` ≈ token-expiry noise from established clients).
Estimate Clerk-step abandonment by comparing daily `mcp_401{no_token,POST}`
volume against `mcp_connection_created`. Filter obvious crawlers by
`user_agent`.

Payload capture is deliberately **off**: we never send `$mcp_parameters` or
`$mcp_response` (they would carry customer mail/sheet content into PostHog).
For the same reason, do not adopt `@posthog/mcp` / `npx @posthog/wizard
mcp-analytics`, which captures both with no redaction option.

Every event (client and server) carries an `environment` property:
`development` (localhost), `preview` (`*.vercel.app`), or `production` — all three
Vercel environments share one PostHog project, so filter on it.

## Sign-up funnel / abandoned sign-ups

Create a PostHog funnel insight: `sign_up_started` → `sign_up_completed`
(conversion window ~1 hour). Drop-off = people who opened the Clerk modal but never
finished (the modal + Google OAuth steps in between are Clerk-internal and not
individually observable). The anonymous click merges into the identified person
once the new user's first signed-in page load calls `identify`.

**Required Clerk dashboard config** (both dev and prod instances): the webhook
endpoint `/api/webhooks/clerk` must be subscribed to `user.created` in addition to
`user.deleted`.

## Separating QA/internal traffic from genuine traffic

1. **Filter every insight to `environment = production`.** This removes all local
   dev-server and preview-deployment traffic (the bulk of QA volume).
2. **Create a cohort "Internal / QA"**: persons where `email` is any of the QA test
   accounts or founder accounts (the emails live in 1Password /
   `.qa_test_emails.json`; they are deliberately not listed in this public repo).
   Exclude the cohort from dashboards. This catches QA runs against production.
3. **Historical events (before this instrumentation)** are anonymous and cannot be
   retro-identified. To triage a past traffic spike, break `$pageview` down by
   `$host`: `localhost:3000` and `*.vercel.app` volume is QA by definition; only
   the production-domain remainder is potentially genuine.

## Implementation notes

- Server capture is fire-and-forget: `captureServerEvent()` no-ops when
  `NEXT_PUBLIC_POSTHOG_KEY`/`_HOST` are unset and flushes via Next's `after()` so
  serverless responses aren't delayed and events aren't dropped.
- MCP instrumentation wraps `server.registerTool` once (see `/api/mcp/route.ts`),
  so newly added tools are instrumented automatically.
- Video plays: Descript embeds implement the player.js (Embedly) protocol and
  also post a bare `descript:embed:played` string to the parent window on
  play (verified empirically 2026-08). `TrackedVideoEmbed` listens for either,
  scoped per-iframe via `event.source`, and captures `video_played` once per
  mount. New demo videos must use `TrackedVideoEmbed`, not a raw `<iframe>`.
- The proxy records `proxy_key_id` (the row's UUID) — never the `sk_proxy_` secret.
