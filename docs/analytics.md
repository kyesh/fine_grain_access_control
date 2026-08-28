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
| `directory_link_clicked` | client (`DirectoryCta.tsx`, all links to the Claude connectors directory listing) | `cta_location`: announcement_bar / setup_step1 / docs_support |
| `sign_up_completed` | server (Clerk webhook, `user.created`) | `$set.email` |
| `video_played` | client (`TrackedVideoEmbed.tsx`, all Descript demo embeds) | `video_id`, `video_title`, `page` |
| `$mcp_tool_call` | server (`/api/mcp`, every tool) | `$mcp_tool_name`, `$mcp_duration_ms`, `$mcp_is_error`, `client_id`, `client_name`, `user_agent`, `outcome`, `account_email`, `account_delegated`; raw tools add `raw_api_kind`, `raw_api_family`, `raw_api_endpoint`, `raw_api_mutating`; denials add `denial_code`, and denials carrying an approval link add `approval_request_id` (joins to the approval funnel); failures add `error_status`, `error_reason`, `error_domain`, `failure_reason`, `gmail_404_site` |
| `proxy_request` | server (`/api/proxy/[...path]`) | `service` (gmail/sheets/drive), `method`, `status`, `outcome`, `duration_ms`, `proxy_key_id`, `account_email`, `account_delegated` |
| `mcp_connection_created` | server (`/api/mcp` auth layer) | `connection_id`, `client_id`, `client_name`/`client_version` (from MCP `initialize` clientInfo, when the creating request was one), `auto_attached`, `account_age_seconds` |
| `mcp_client_initialize` | server (`/api/mcp` auth layer, every authenticated `initialize`) | `client_name`, `client_version` (the client's self-reported MCP clientInfo), `client_id`, `user_agent`. Once per MCP session — the substrate for the per-product split (Cowork / Claude Code / Claude.ai) |
| `delegation_created` | server (dashboard action) | `delegate_email`, `reactivated` |
| `account_linked` | server (dashboard action) | `target_email`, `delegated`, `via` |
| `approval_link_minted` | server (`/api/mcp` — policy denial, send denial, `request_access`) | `action`, `request_id`, `target_hash`, `mint_count`, `via` (`send_denial`/`request_access`; absent for policy denials). **Fires once per mint ATTEMPT**, so `uniq(request_id)` is demand and `count()` is retry pressure |
| `approval_link_opened` | server (approve-page load, `/dashboard/approve`) | `status` (`fresh`/`already_granted`/`invalid`), `request_id`, `action`, `agent_driven`, `user_agent` |
| `approval_link_approved` | server (`actions.ts`, all approval paths) | `action`, `request_id`; per-file grants add `substituted` and `granted_count` |
| `read_restriction_enforced` | server (`/api/mcp`) | `via` (tool name), `restriction` |
| `sheets_grant_verification` | server (approve-page load via `/api/rules/verify-sheets-access`, and approval in `actions.ts`) | `result` (`ok`/`missing`/`unknown`), `via` (`link_open`/`magic_link`/`post_approval`), `spreadsheet_id` |
| `sheets_grant_recovered` | server (`/api/rules/verify-sheets-access`) | `spreadsheet_id` |
| `docs_grant_verification` / `docs_grant_recovered` | server (`/api/rules/verify-docs-access`, approval in `actions.ts`) | docs twins of the sheets grant-funnel events, with `document_id` |
| `google_token_fetch_failed` | server (MCP `getGoogleToken`, proxy `fetchClerkGoogleToken`, `getOwnerGoogleToken`) | `reason` (`refresh_failed` = Clerk 422 cannot-refresh, `clerk_error`), `via` (`mcp`/`proxy`/`grant_check`), `account_delegated`. The `$mcp_tool_call` event also carries `google_token_error` on affected calls. Added 2026-08-20 after the dev-instance refresh-token loss was found; this is the signal for whether production users hit it too |
| `google_token_identity_fallback` | server (MCP `getGoogleToken`) | `via` (`mcp`). Fires when a key owner's own mailbox is reached through the identity-drift self-heal added in `4b551018` — the target address is not a delegation but IS one of the owner's verified Clerk addresses. Unsampled, and independent of `$mcp_tool_call`, so `uniq(person)` is exactly the drifted population still being rescued; the same call also carries `google_token_identity_fallback: true` on `$mcp_tool_call`. Expected to trend to zero as users self-heal — see docs/monitoring.md 7.4 |
| `mcp_auth_attempt` | server (`/api/mcp` `verifyMcpAuth`) | `outcome` (`ok`/`invalid_token`/`no_token`), `client_id`, `strategy_used` (`clerk`/`direct`/`none`), `memo_hit`, `optimizations_enabled`, `success_sample_rate`, `error_class`, `kid` (on `invalid_token` only), `method`. Auth-health substrate for the JWKS/strategy optimizations. **Failures are unsampled; successes are a 1-in-20 per-request sample** — multiply `ok` by 20 for volume, valid only from the 2026-08-25 fix onward (two earlier versions sampled per-token and were biased; see docs/monitoring.md 1). `kid = 'probe'` marks our own synthetic probes, not users |
| `agent_doc_created` | server (`/api/mcp`, raw `POST v1/documents`) | `document_id`, `auto_granted` (docs twin of `agent_sheet_created`) |
| `connector_install_started` | server (`.well-known` OAuth discovery routes, `/api/mcp` auth layer) | `touchpoint` (`oauth_discovery`/`mcp_401`), `endpoint`, `reason` (`no_token`/`invalid_token`), `method`, `user_agent`, `install_fingerprint` (salted sha256 of ip+user-agent — the uniqueness key; see funnel note below), `client_name`/`client_version` (mcp_401 only, when the unauthenticated request was an MCP `initialize`) |

### The approval funnel: count REQUESTS, not links

**An approval request is one `request_id`. Mint events per `request_id` are
retries, not demand.**

`request_id` is a deterministic HMAC of (user, proxy key, action, target), so
denying the same operation repeatedly re-emits the SAME id and the same URL.
Join `approval_link_minted` → `approval_link_opened` → `approval_link_approved`
on it, and count `uniq(request_id)` at every stage.

This is the definition the funnel lacked before 2026-08-25, and its absence was
expensive. The old `link_id` was a per-mint JWT `jti`, so every agent retry
produced a new id and looked like fresh unopened demand. The same 14-day window
read as **31% approved** counted per link and **~58%** counted per request;
`sheets_expose`, reported as the worst-converting action at 30.7%, was actually
the best established one at 83.3% because it simply had the most retries
(2.93 links per request). Four separate analyses produced four different
numbers — 26%, 31%, 68%, 58% — purely from choosing different groupings.

Two further cautions when reading this funnel:

- **Report approvals, not opens.** `approval_link_approved` requires a form
  submit on a page naming the grant; it is the only stage that proves a
  deliberate human act. `approval_link_opened` only proves an authenticated
  session rendered the page — measured against client-side pageviews, ~23% of
  approve-page loads were an AI agent rather than a person, which is why
  `agent_driven` now rides on the event.
- **Send denials mint TWO requests** (`send_whitelist` and `send_all`), of
  which a human can only ever open one. Send actions therefore carry roughly
  double the request count of a single-option denial.
- **Server-side events carry no browser user agent**, so PostHog labels every
  `posthog-node` event `Automation` / `$virt_is_bot: true`. That label is a
  capture artifact and says nothing about human involvement — do not filter on
  it. (Control: client-side `$pageview` splits Regular/AI Agent normally.)

**HogQL gotcha:** `properties.status` silently returns NULL on the `events`
table — `status` is shadowed by a table field, so dot access resolves to the
wrong thing. The property IS ingested; read it as
`JSONExtractString(properties, 'status')`. Verified 2026-08-25 after the
dot-access form made a correctly-emitted property look missing on both
production and development events. `action`, `request_id`, `agent_driven` and
`user_agent` are unaffected and work with dot access.

`approval_requests` (Postgres) mirrors this in SQL — one row per request with
`mint_count`, `opened_at`, and `approved_at` — so the same questions are
answerable without the analytics pipeline.

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
(🚫 FGAC rule), `pending_approval` (⏳ connection not yet approved),
`size_capped` (⚠️ deliberate refusal to return an oversized payload — the tool
worked; before 2026-08-24 this classified as `failed` and inflated
`gmail_get_attachment` error-rate readings), `failed` (❌ auth/input problems — these carry `failure_reason`, see below),
`error` (upstream Google failure), `exception`.
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

**Google failure reason (gmail-failure-path-telemetry plan, 2026-08-26):**
`error_status` records only the HTTP status, which Google multiplexes across
unrelated conditions — most consequentially 403, which covers both a
missing/revoked OAuth scope and plain throttling. Every non-OK response now
also stamps `error_reason` (Google's `error.errors[0].reason`, e.g.
`rateLimitExceeded`, `insufficientPermissions`, `domainPolicy`) and
`error_domain` (`error.errors[0].domain`, e.g. `usageLimits`) when present.
These are Google-defined enum strings, never customer data. `describeGoogleError`
branches its 403 remediation on them: before this, the 403 text asserted the
scope cause unconditionally and told rate-limited callers to reconnect a
working Google account — advice that is wrong for the whole `usageLimits`
class and that suppressed the retry which would have succeeded. **The
`insufficientPermissions` vs `usageLimits` split in production was unmeasured
when this shipped** (no PostHog query access at the time); `error_reason` is
what makes it measurable.

`gmail_get_attachment` issues two requests — the parent message read, then the
attachment read — and both used to return the same generic "check the ID"
404. `gmail_404_site` (`message` | `attachment`) records which one failed.
`attachment` is the informative value: it means the parent read *succeeded*,
so the `messageId` is valid and the `attachmentId` is stale — the recoverable
case, since Gmail re-issues attachment ids when a message is re-indexed. This
property is the direct measure of open question "what is behind the
gmail_get_attachment 404s".

**Account-resolution failures (`failure_reason`):** `resolveAccountAndToken`'s
four failure branches (`no_proxy_key`, `no_accessible_accounts`,
`account_not_permitted`, `google_token_unavailable`) return ❌ text without
ever reaching Google, so they carry no `error_status` and which branch fired
used to be unrecoverable — the `outcome='failed'` blind class.
`failure_reason` names the branch.

> **Do not "tidy" these into `errorResult`.** They stay `textResult` on
> purpose. `classifyToolOutcome` maps them to `failed`, and `$mcp_is_error` is
> true only for `error`/`exception` — so today they are *not* counted as
> errors by the field Anthropic's Connector Directory reads. Promoting them
> would import them into our published error rate purely to gain internal
> visibility that `failure_reason` already provides for free. `failure_reason`
> is also deliberately separate from `error_status`, which means "Google
> returned this HTTP status"; overloading it would corrupt that series.

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
from this distribution. `gmail_get_attachment` additionally carries
`attachment_chars`/`attachment_kb` on EVERY outcome that reaches the
attachment fetch — including the over-cap ⚠️ refusal (`outcome=size_capped`
since 2026-08-24), where the generic props only see the short refusal
message, so these are the only record of the actual size that triggered the
cap. Events where the attachment fetch itself failed can't carry a measured
size; those instead carry `attachment_declared_kb`, the size declared in the
parent message's MIME metadata (stamped before the fetch), so error rows are
still attributable to size vs genuine upstream failure. (These
two props were documented ahead of the code: the original commit `5aa23bd`
was stranded on an unmerged branch and the props first ship with the
raw-api-classification change, 2026-08-21.) The pre-existing 200k-char cap
is unchanged.

**Raw Google API classification (raw-api-classification plan):** every
`google_api_get` / `google_api_modify` call stamps four props at
classification time, denials included — `raw_api_kind` (the
`classifyGoogleApiCall` result: `sheets`, `sheets_create`, `docs`,
`docs_create`, `gmail_read`, `gmail_send`, `passthrough`, `denied`),
`raw_api_family` (Google product: `gmail`, `spreadsheets`, `documents`, or
the classifier's first-two-segments family for passthroughs; omitted on
denials, which carry `denial_code`), `raw_api_endpoint` (the HTTP method plus
the **id-stripped** path template from `templateGoogleApiPath`, e.g.
`GET gmail/v1/users/me/messages/{id}` — identifiers are customer data and
high-cardinality, so they never land on events), and `raw_api_mutating`.
Passthrough calls additionally keep `raw_api_passthrough: true`. Raw paths
were never captured before this change, so there is no backfill — coverage
starts at the deploy.

**`client_name`:** populated from the MCP `initialize` handshake's
clientInfo — the auth layer parses it (the only request that carries it in
stateless streamable HTTP; see `src/lib/mcpClientSignals.ts`), stores it on
`agent_connections.client_name` at creation, and backfills rows still holding
the opaque `client_id` placeholder on their next initialize. It then rides on
every `$mcp_tool_call` (via `requireApproval`) alongside `user_agent`, and
`mcp_client_initialize` records it once per session — this is what makes the
per-product split (Cowork / Claude Code / Claude.ai) reproducible. Coverage
starts at the deploy; rows for clients that never re-initialize stay opaque.
Capturing DCR `client_name` at OAuth registration remains a possible
supplement.

**`connector_install_started`: count `uniq(install_fingerprint)`, never raw
events.** It fires anonymously (distinct_id `anonymous-mcp`) from the only
FGAC-owned touchpoints that exist before a Clerk account: the OAuth discovery
endpoints (`touchpoint=oauth_discovery`, recurs on reconnects) and
unauthenticated MCP requests (`touchpoint=mcp_401`). The mcp_401 emission is
**per-request identical to `mcp_auth_attempt` failures by construction**
(same `!authInfo` path in `verifyMcpAuth`; `reason` ≡ `outcome`), so raw
event counts are 401/retry volume — an established client with an expired
token can emit dozens of "installs" a day, which is exactly the artifact
that made install→signup conversion look like it collapsed in late August
2026. `install_fingerprint` (salted sha256 of ip+user-agent; salt =
`ANALYTICS_FINGERPRINT_SALT`, falling back to `CLERK_SECRET_KEY`) is the
uniqueness key: unique installers per day ≈
`uniq(properties.install_fingerprint)` filtered to `reason='no_token'` and
`method='POST'`, and Clerk-step abandonment compares that against
`mcp_connection_created`. Coverage starts at the fingerprint deploy
(2026-08-27); earlier data supports no unique-count reading at all. Filter
obvious crawlers by `user_agent`. Rotating the salt resets fingerprint
continuity — compare uniques only within one salt era.

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
