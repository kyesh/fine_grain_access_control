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
| `$mcp_tool_call` | server (`/api/mcp`, every tool) | `$mcp_tool_name`, `$mcp_duration_ms`, `$mcp_is_error`, `client_id`, `outcome`, `outcome_reason`, `google_status`, `result_message` (non-success only), `account_email`, `account_delegated`, `spreadsheet_id` (sheets calls) |
| `proxy_request` | server (`/api/proxy/[...path]`) | `service` (gmail/sheets/drive), `method`, `status`, `outcome`, `duration_ms`, `proxy_key_id`, `account_email`, `account_delegated` |
| `mcp_connection_created` | server (`/api/mcp` auth layer) | `connection_id`, `client_id`, `auto_attached`, `account_age_seconds` |
| `delegation_created` | server (dashboard action) | `delegate_email`, `reactivated` |
| `account_linked` | server (dashboard action) | `target_email`, `delegated`, `via` |
| `approval_link_minted` | server (`/api/mcp`) | `action` |
| `read_restriction_enforced` | server (`/api/mcp`) | `via` (tool name), `restriction` |
| `sheets_grant_verification` | server (approve-page load and recovery re-checks via `/api/rules/verify-sheets-access`; approval and manual rule creation in `actions.ts`) | `result` (`ok`/`missing`/`unknown`), `via` (`link_open`/`magic_link`/`recovery`/`dashboard_manual`), `spreadsheet_id` |
| `sheets_grant_recovered` | server (`/api/rules/verify-sheets-access`) | `spreadsheet_id` |
| `rule_created` | server (dashboard actions: `createRule`, `exposeSheetsFromPicker`, magic-link sheet approval) | `service`, `action_type`, `via` (`dashboard_manual`/`dashboard_picker`/`magic_link`), `spreadsheet_id` (sheets), `keys_assigned`/`profile_scoped` |
| `sheets_picker_scope_redirect` | client (`useGooglePicker.ts`) | — (surface via `$pathname`) |
| `sheets_picker_opened` | client (`useGooglePicker.ts`) | `from_oauth_return` |
| `sheets_picker_picked` | client (`useGooglePicker.ts`) | `count` |
| `sheets_picker_cancelled` | client (`useGooglePicker.ts`) | — |
| `sheets_picker_error` | client (`useGooglePicker.ts`) | `message` (truncated) |

The two `sheets_grant_*` events instrument the **picker-first sheets
approval funnel**: opening a sheets approval link verifies the Google-side
`drive.file` grant (`via=link_open`); `result=missing` puts the Picker +
demo-video step BEFORE the approve button, and the approval itself re-fires
with `via=magic_link`. Picking a different sheet than the agent asked for is
an explicit substitution — `approval_link_approved` then carries
`substituted: true` and `granted_count`, making wrong-agent-id frequency
measurable. `/dashboard/sheets-setup` remains the recovery path for
pre-existing stranded rules (dashboard chips, MCP error links); every re-check
there fires `sheets_grant_verification{via=recovery}` and a verified one adds
`sheets_grant_recovered`. Funnel health = `link_open{missing}` →
`magic_link{ok}` conversion.

**Sheet-adoption funnel** ("user successfully adds a Google Sheet"), across
all three creation surfaces (`rule_created.via`): client picker steps
(`sheets_picker_scope_redirect` → `sheets_picker_opened` →
`sheets_picker_picked`/`_cancelled`, surface from `$pathname`) → `rule_created`
→ first `$mcp_tool_call{outcome=success}` whose `spreadsheet_id` matches
(stamped by `checkSheetsPermission`, on denied outcomes too). A
`sheets_picker_scope_redirect` with no later `sheets_picker_opened` is a user
lost in the Google consent round-trip; a `rule_created{via=dashboard_manual}`
whose `sheets_grant_verification{via=dashboard_manual}` says `missing` is a
rule stranded at birth (hand-typed id, no Picker grant).

`$mcp_tool_call` uses PostHog's **canonical MCP Analytics schema** (event and
`$mcp_*` property names) so PostHog's built-in MCP views resolve the tool name.
`$mcp_is_error` is true only for upstream failures/exceptions; the finer-grained
FGAC story is in the custom `outcome` property: `success`, `denied_by_policy`
(🚫 FGAC rule), `pending_approval` (⏳ connection not yet approved), `failed`
(❌ auth/input problems), `error` (upstream Google failure), `exception`.
Unauthenticated calls attribute to the `anonymous-mcp` / `anonymous-proxy` persons.

Every non-success outcome also answers **why**, via two layers:

- **`outcome_reason`** — a stable snake_case code set at the site that produced
  the denial/failure (`addToolCallProps`): `connection_pending_approval` /
  `connection_blocked` / `connection_no_client_id` / `connection_user_not_found`,
  `no_proxy_key`, `no_accessible_emails`, `account_not_accessible`,
  `google_token_unavailable`, `send_not_whitelisted` / `send_disabled` /
  `send_recipients_unparseable`, `sheets_not_exposed` / `sheets_blocked` /
  `sheets_read_only`, `sheets_grant_missing` (post-policy Google 403/404 on a
  sheet — the missing-Picker-grant case), `read_restricted`,
  `google_api_call_denied`, `request_access_invalid_args`, and
  `google_<status>` / `google_network_error` for other upstream failures
  (`google_status` carries the numeric HTTP status).
- **`result_message`** — the tool's returned text, URL-stripped (approval links
  embed signed tokens) and capped at 200 chars; on `exception`, the thrown
  error's message. The catch-all for any path without a reason code.

Debugging "why is this user erroring" should never need code archaeology
again: group their `$mcp_tool_call` by `outcome_reason`.

> **Legacy naming (before 2026-08):** tool calls were captured as a custom
> `mcp_tool_call` event with `tool` / `duration_ms` properties. That name
> collides with the event PostHog's archived beta MCP SDK once emitted, so the
> PostHog UI labels it "MCP tool call (legacy)" and its MCP views show no tool
> name (they read `$mcp_tool_name`). The old events still exist under the old
> name — insights spanning the rename must query both. Nothing in this codebase
> should ever emit `mcp_tool_call` again; QA capability 16 asserts this.

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
