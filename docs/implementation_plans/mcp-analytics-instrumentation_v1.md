# Analytics Instrumentation: MCP/Proxy Usage + Clerk↔PostHog Consolidation

Branch: `claude/mcp-analytics-instrumentation-d51eff`

## Problem

PostHog shows a traffic jump and we cannot tell genuine new traffic from internal QA
testing. Additional ask: measure MCP server / API pass-through usage, and capture
abandoned sign-up flows.

## Review findings (current state)

1. **PostHog is client-side pageviews only.** `providers.tsx` inits `posthog-js`
   (`person_profiles: 'identified_only'`), `PostHogPageView.tsx` captures `$pageview`.
   That is the entire integration.
2. **`posthog.identify()` is never called.** Every visitor — including the QA test
   accounts — is an anonymous device. PostHog persons cannot be joined to Clerk users,
   which is exactly why QA traffic is indistinguishable from real traffic.
3. **All three Vercel environments share one PostHog project.**
   `NEXT_PUBLIC_POSTHOG_KEY/HOST` are set for Development, Preview, AND Production.
   Local QA dev servers and preview deployments report into the same project as
   production. QA runs generate heavy dashboard pageview volume → this is the most
   likely source of the "jump".
   - *Immediate diagnostic (no code needed):* `$pageview` events carry
     `$current_url`/`$host`. Breaking the spike down by `$host` shows how much is
     `localhost:3000` / `*.vercel.app` vs the production domain.
4. **The MCP server (`/api/mcp`) and the raw API proxy (`/api/proxy/[...path]`) emit
   zero analytics.** The traffic jump cannot be MCP/proxy usage — that layer is
   invisible to PostHog today.
5. **No sign-up funnel.** Clerk's `<SignUpButton mode="modal">` is used in 3 places
   (nav, hero, bottom CTA); no events on click, no completion event. The Clerk webhook
   handles only `user.deleted`.

## Design

### A. Identity consolidation (client)

- New `PostHogIdentify` client component (mounted in `layout.tsx` inside both
  providers): on signed-in, `posthog.identify(clerkUserId, { email, name })`; on
  signed-out, `posthog.reset()`. Distinct id = **Clerk user id** everywhere.
- `providers.tsx` registers a super property `environment` on every client event,
  derived from hostname (`localhost*` → development, `*.vercel.app` → preview, else
  production). Hostname beats env vars here — it needs no Vercel system-var exposure.

### B. Server-side capture (`src/lib/posthogServer.ts`)

- `posthog-node` singleton (`flushAt: 1, flushInterval: 0`), no-op when
  `NEXT_PUBLIC_POSTHOG_KEY` is unset, flushed via `after()` so serverless doesn't
  drop events. All events tagged `environment: VERCEL_ENV ?? 'development'`.
- Server events use the same Clerk user id as distinct id, so they merge into the
  same PostHog person the client identified.

### C. MCP instrumentation (`/api/mcp`)

- `withAnalytics(toolName, handler)` wraps each of the 12 `registerTool` handlers.
- Event `mcp_tool_call`: `tool`, `client_id`, `outcome`, `duration_ms`,
  `connection status` context where cheap. Outcome classified from the result the
  tool already returns (`isError` → error; leading `⏳` → pending_approval; `🚫` →
  denied_by_rule; `❌` → failed; else success) — matching the response conventions
  documented in the route.
- Distinct id: `authInfo.extra.userId` (Clerk id) or `anonymous-mcp`.

### D. Proxy instrumentation (`/api/proxy/[...path]`)

- `handleProxyRequest` gains a mutable `telemetry` param it populates as identity
  resolves (clerk user id, proxy key id, email). A single wrapper used by all five
  HTTP method exports captures `proxy_request`: `service` (gmail/sheets/drive),
  `method`, `status`, `outcome` (success / denied / auth_failed / error),
  `duration_ms`, `proxy_key_id` (row id, never the secret).

### E. Sign-up funnel

- New `SignUpCta` client component wrapping Clerk's `SignUpButton`, capturing
  `sign_up_started` with `cta_location` (nav / hero / bottom_cta) on click. Replaces
  the three inline usages.
- Clerk webhook handles `user.created`: server-side `identify` (email person
  property) + `sign_up_completed` capture with distinct id = Clerk user id. Because
  the click event's anonymous device id gets merged when the client later calls
  `identify` with the same Clerk id, PostHog funnels connect the two.
- **Abandoned sign-ups = funnel drop-off**: PostHog funnel insight
  `sign_up_started` → `sign_up_completed`. Everything in between happens inside
  Clerk's modal + Google OAuth, which we cannot instrument step-by-step; the
  start/complete pair is the actionable signal.
- ⚠️ Operator action: subscribe the Clerk webhook endpoint to `user.created`
  (currently only `user.deleted`) in the Clerk dashboard, both instances.

### F. Separating QA from genuine traffic (dashboard practice, documented in
`docs/analytics.md`)

1. Filter insights to `environment = production`.
2. Create a cohort "Internal/QA" of persons whose email matches the QA/founder
   accounts (emails live in PostHog, not in this public repo) and exclude it.
3. Historical (pre-identify) events: break down by `$host` to strip localhost/preview
   noise; anonymous production-host events from the QA period remain ambiguous —
   accept and annotate.

## Out of scope

- No schema changes. No new env vars. No PII beyond what PostHog already holds
  (emails as person properties on identified users).
