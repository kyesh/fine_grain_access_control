# Auth & MCP Endpoint Monitoring

Monitoring stack for the `/api/mcp` auth path, introduced alongside the JWKS
singleton + strategy-memo optimizations (see
`docs/implementation_plans/claude/mcp-auth-cache-monitoring_v1.md`).

Guiding principle: **an auth regression looks like silence, not errors** — MCP
clients that receive 401s stop calling. Monitoring therefore watches volume
floors as much as error rates.

## 1. Instrumentation: `mcp_auth_attempt` (PostHog, server-side)

Captured in `verifyMcpAuth` (`src/app/api/mcp/route.ts`):

| property | meaning |
| --- | --- |
| `outcome` | `ok` \| `invalid_token` \| `no_token` |
| `strategy_used` | `clerk` \| `direct` \| `none` |
| `memo_hit` | whether the per-client strategy memo routed this request |
| `optimizations_enabled` | kill-switch state at capture time |
| `error_class` | Clerk auth() error name, when it threw |
| `kid` | signing-key id from the (unverified) token header, on `invalid_token` only |

Volume control: failures always capture; successes are sampled **1 in 20**
(deterministic per token; `success_sample_rate` property carries the factor).
Multiply `outcome=ok` counts by 20 to estimate true success volume.

## 2–3. PostHog alerts (hourly evaluation, email to Ken)

| alert | insight | threshold | rationale |
| --- | --- | --- | --- |
| MCP tool-call volume floor | [MFYwjsQU](https://us.posthog.com/project/343912/insights/MFYwjsQU) | completed day < 50 tool calls | observed daily range 168–1,203 post-launch; near-zero = clients silently locked out |
| MCP invalid_token spike | [mGzUClRs](https://us.posthog.com/project/343912/insights/mGzUClRs) | day (incl. today) > 50 invalid_token failures | baseline ~0–1/day; a spike means verification broke or a rejection storm |

Threshold review: revisit both after 2 weeks of `mcp_auth_attempt` history.

## 4. Synthetic probe

- `scripts/mcp-auth-probe.ts` — no-secret probes: 401+`WWW-Authenticate` on
  bare POST, 401 on garbage token (pinned-issuer path), 200 on OAuth resource
  metadata. Optional `PROBE_PROXY_KEY` (QA `sk_proxy_` key) adds an
  authenticated `/api/proxy` leg.
- `.github/workflows/auth-probe.yml` — every 15 min against https://fgac.ai;
  a failing run is the alert (GitHub notifies on workflow failure).
- Run manually against any environment:
  `PROBE_BASE_URL=https://<preview-url> npx tsx scripts/mcp-auth-probe.ts`
- **Known gap**: no synthetic covers the fully-authenticated MCP OAuth path
  (needs a live Clerk OAuth client token). The proxy leg covers DB + key auth +
  Google token retrieval; real-user coverage of the OAuth path comes from the
  volume-floor alert.

## 5. Vercel Observability baseline (pre-optimization)

Production, last 12h, read 2026-08-23 (project → Observability → Functions):

| metric | value |
| --- | --- |
| `/api/mcp` invocations share | 74% of all function invocations |
| Active CPU per `/api/mcp` request | ~68 ms |
| P75 Active CPU (all routes) | 153 ms |
| `/api/mcp` error rate | 0% |
| Cold start rate | 6.7% |
| CPU throttle P75 (Hobby) | 15.4% |

After the production deploy, re-read the same view and compare Active CPU per
request and error rate. Expected: CPU down 30–50%; error rate unchanged at ~0%.

## 6. Rollout / rollback

- Kill switch: set `MCP_AUTH_OPTIMIZATIONS=disabled` in Vercel env and
  redeploy — restores legacy auth behavior (fresh JWKS per request, fixed
  clerk→direct order) without a code revert.
- Rollout order: preview validation (`/deploy-pr-preview` + probe script
  against the preview URL) → user-gated production deploy (`/deploy-prod`) →
  Observability + `mcp_auth_attempt` comparison after 24h.
