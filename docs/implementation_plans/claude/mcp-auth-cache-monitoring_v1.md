# MCP Auth Optimization (A+B) + Auth Monitoring — v1

Branch: `claude/mcp-auth-cache-monitoring`
Context: Vercel dashboard shows `/api/mcp` at ~68ms Active CPU per request (74% of
invocations), driven by per-request auth overhead — a fresh `createRemoteJWKSet`
(= JWKS HTTPS fetch) on every direct-JWT fallback, and a doomed Clerk `auth()`
attempt before every CLI-client fallback. Post-launch run rate ≈ 4.2 CPU-hr/mo,
right at the Hobby 4-hr cap.

## Scope

### A. Module-scope JWKS singleton
- Hoist `createRemoteJWKSet` out of `verifyClerkJwtDirect` into a lazy
  module-scope singleton keyed by issuer (one issuer in practice — our own
  Clerk instance; pinned-issuer check is unchanged).
- `cacheMaxAge: 5 min`, `cooldownDuration: 30s` — bounds "trust a retired
  signing key" to ≤5 min while jose still refetches immediately on unknown kid.

### B. Per-client strategy memo
- Bounded memo (Map, LRU-ish, cap 500) from `client_id` → which strategy
  (`clerk` | `direct`) last succeeded. Routing hint ONLY:
  - client_id for routing is read from the *unverified* token payload — safe
    because it only picks try-order; both verifiers remain fail-closed and the
    other strategy still runs if the preferred one fails.
  - On success, record the winning strategy.
- Eliminates the wasted Clerk `auth()` round-trip on every CLI request.

### Kill switch (monitoring #6)
- `MCP_AUTH_OPTIMIZATIONS=disabled` env var reverts to legacy behavior
  (fresh JWKSet per call, fixed clerk→direct order). Rollback = env change +
  redeploy, no code revert.

### Monitoring #1: auth outcome instrumentation
- New server-side PostHog event `mcp_auth_attempt` captured in `verifyMcpAuth`:
  `strategy_used` (clerk|direct|none), `outcome` (ok|no_token|invalid_token),
  `error_class`, `memo_hit` (bool), `kid` (on direct-path failures), `method`.
- Volume control: MCP requests run ~220k/mo vs PostHog free tier 1M events.
  Capture ALL failures; sample successes 1-in-20 (deterministic on token hash so
  a given session is consistently in/out). Adds ≈11k events/mo + failures.
- Existing `connector_install_started` 401 counter unchanged (funnel metric).

### Monitoring #2+#3: PostHog alerts
- Insight + alert: `$mcp_tool_call` daily volume floor (catches "auth broke,
  clients went silent" — the signature of an auth regression is absent traffic,
  not error spikes).
- Insight + alert: `mcp_auth_attempt` failures with `outcome=invalid_token`
  spiking above baseline.
- Created via PostHog API/MCP; documented in docs/monitoring.md.

### Monitoring #4: synthetic probe
- `scripts/mcp-auth-probe.ts`: no-secret probes against a base URL —
  1. `POST /api/mcp` (no token) → expect 401 + `WWW-Authenticate` header
  2. `POST /api/mcp` (garbage token) → expect 401 (exercises pinned-issuer
     rejection in the direct-JWT path)
  3. `GET /.well-known/oauth-protected-resource/mcp` → expect 200 JSON
  4. Optional authenticated leg: `PROBE_PROXY_KEY` env (QA `sk_proxy_` key) →
     `GET /api/proxy/gmail/v1/users/me/profile` → expect 200. Validates
     DB + key auth + Google token path. (A full MCP OAuth synthetic needs a
     live Clerk OAuth client token; out of scope — documented gap.)
- `.github/workflows/auth-probe.yml`: cron every 15 min against
  https://fgac.ai, runs probes 1–3 (no secrets); if the repo secret
  `PROBE_PROXY_KEY` is configured, also runs leg 4. Failure → workflow failure
  → GitHub notification. Public repo: workflow contains no secrets or
  customer data.

### Monitoring #5: Observability before/after
- Baseline captured 2026-08-23 (production, last 12h): `/api/mcp` 886 inv,
  ~68ms active CPU/req, P75 active CPU 153ms, 0% error rate, cold start 6.7%.
- After preview validation + production deploy (user-gated), re-read the same
  Observability view and compare. Recorded in docs/monitoring.md.

## Validation plan
1. `npx tsc --noEmit` + build.
2. Local dev server: probe script against localhost (legs 1–3), confirm 401
   shape unchanged and no [MCP] errors in logs.
3. `/deploy-pr-preview`: push branch, wait for preview, run probe legs 1–3
   against the preview URL, exercise a signed-in dashboard flow in the
   built-in browser, check preview function logs for auth errors.
4. Production deploy is user-gated (`/deploy-prod`); after it, re-check
   Observability CPU + error rate and PostHog `mcp_auth_attempt` mix.

## Non-goals
- C (verification-result cache) — deferred pending revocation-latency decision.
- Cold-start/module-graph trimming.
