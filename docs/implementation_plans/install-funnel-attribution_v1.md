# Install-Funnel Uniqueness + Client Product Attribution — v1

Branch: `claude/install-funnel-attribution` (2026-08-27)

## Problem

1. **Top-of-funnel is uncountable.** Every `connector_install_started` emission
   uses the literal distinct_id `anonymous-mcp`, so `uniq(distinct_id)` = 1 per
   bucket. Daily counts are 401/retry volume, not people.
2. **The mcp_401 touchpoint double-counts auth retries as installs.** Verified
   structurally in `src/app/api/mcp/route.ts` (`verifyMcpAuth`): the
   `mcp_auth_attempt` capture fires on every failure (`outcome !== 'ok'`) and
   `connector_install_started{touchpoint:'mcp_401'}` fires on the same requests
   (`!authInfo`), with `reason` ≡ `outcome`. The two are per-request identical
   by construction — the measured 2026-08-26 parity (77 no_token + 26
   invalid_token on both events) is exactly what the code guarantees. So
   "install" volume is retry volume, and the apparent install→signup conversion
   collapse is an artifact of established clients retrying with expired tokens.
3. **Client product attribution is missing.** `client_id` is an opaque
   per-user DCR token; no `initialize` clientInfo or user-agent is captured, so
   the Anthropic directory's per-product split (Cowork / Claude Code /
   Claude.ai) cannot be reproduced.

## Established facts (this session)

- mcp-handler 1.1.0 runs **stateless** here (no Redis config): every POST
  builds a fresh `McpServer`, so `server.getClientVersion()` is undefined
  during `tools/call` — the only place `initialize` clientInfo exists
  server-side is the `initialize` POST itself. That request passes through our
  own `verifyMcpAuth(req, token)`, which holds the raw `Request` — clone-parse
  there.
- Available anonymous signals at the 401/discovery point: `x-forwarded-for` /
  `x-real-ip` (Vercel-set), `user-agent`, and — on `invalid_token` only — the
  unverified JWT's `client_id`. No MCP session id exists in stateless mode.
- `agent_connections.clientName` (text, no length cap) currently stores the
  opaque client_id (`clientName: clientId` at insert), and `requireApproval`
  already stamps it as `client_name` on `$mcp_tool_call` — making the stored
  name real retroactively lights up existing attribution.
- `google_token_identity_fallback`: the standalone event was added in
  `2ed046b` (in main 2026-08-25). Production shows only the *property* (28
  true in the week ending 2026-08-27) → prod predates that deploy. Docs must
  say to query the property until the deploy lands — and 28/week is non-zero,
  which monitoring.md 7.4 defines as investigate-worthy new drift.

## Changes

1. **`src/lib/mcpClientSignals.ts` (new)** — `installFingerprint(req)`:
   sha256(`salt|ip|ua`) truncated to 32 hex chars; salt =
   `ANALYTICS_FINGERPRINT_SALT` ?? `CLERK_SECRET_KEY` (always provisioned) so
   raw IPs never reach PostHog and the hash is not brute-forceable without the
   salt. Also `parseInitializeClientInfo(req)`: size-guarded clone-parse of a
   POST body; returns `{name, version}` from `initialize` params (batch-aware),
   truncated (128/32), never throws.
2. **`src/app/api/mcp/route.ts`**
   - `connector_install_started{mcp_401}` gains `install_fingerprint`, and —
     when the unauthenticated request is itself an `initialize` —
     `client_name`/`client_version`.
   - New event **`mcp_client_initialize`** on every authenticated `initialize`
     (distinct_id = Clerk user id): `client_name`, `client_version`,
     `client_id`, `user_agent`. This is the once-per-session product-split
     substrate.
   - `verifyMcpAuth` threads clientInfo into the eager `resolveConnection`;
     the insert uses the real name (`clientHint.name ?? clientId`) and
     `mcp_connection_created` gains `client_name`/`client_version`. Existing
     rows whose `clientName` is still the opaque placeholder
     (`clientName === clientId`) get backfilled on the next initialize via the
     existing `lastUsedAt` update.
   - `$mcp_tool_call` gains `user_agent` (stashed on `authInfo.extra` in
     `verifyMcpAuth`); `client_name` already rides via `requireApproval`.
3. **`.well-known` discovery routes (both)** — add `install_fingerprint`.
4. **Docs** — `analytics.md` (event table + funnel paragraph: unique installers
   = `uniq(properties.install_fingerprint)` where `reason='no_token'`,
   coverage starts at deploy; client_name caveat updated), `monitoring.md`
   (install-funnel query on the fingerprint; 7.4 deploy-lag note + the
   2026-08-27 28/week property observation).
5. **Analytics-review scheduled task** — update its assumptions: install→signup
   conversion is undefined before fingerprint coverage; use
   `uniq(install_fingerprint)` after.

## Explicitly rejected

- Changing when `connector_install_started` fires (e.g. suppressing
  `invalid_token`): keeps history comparable; the fingerprint + existing
  `reason` property lets analysts define installs without breaking the series.
- Deriving a product label server-side from user-agent: we have no data on
  what UAs the clients actually send (PostHog query access is unprovisioned in
  this session). Ship raw signals first; derive once observed.
- `server.oninitialized` / SDK hooks: never fire on the instance that handles
  tool calls in stateless mode (fresh server per POST).

## Validation

- `npx tsc --noEmit`, local dev server exercise of `/api/mcp` 401 path and
  `.well-known` routes (fingerprint present, stable per ip+ua, no raw ip/ua
  leak beyond the already-captured user_agent).
- PostHog before/after queries are **named** in the PR; execution is blocked in
  this session (`POSTHOG_PERSONAL_API_KEY` unprovisioned — `env:check`
  confirms). After preview deploy + a probe request:
  `SELECT properties.install_fingerprint, count() FROM events WHERE event =
  'connector_install_started' AND properties.environment = 'preview' GROUP BY 1`.
