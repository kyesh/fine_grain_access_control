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
| `client_id` | OAuth client registration id — opaque, per client registration, never a user identifier. Verified value on `ok`; the unverified token claim on failures (present so a 401 storm can be attributed to a client). Same property already carried by `$mcp_tool_call` and `mcp_connection_created`, so the three join on it |
| `strategy_used` | `clerk` \| `direct` \| `none` |
| `memo_hit` | whether the per-client strategy memo routed this request |
| `optimizations_enabled` | kill-switch state at capture time |
| `error_class` | Clerk auth() error name, when it threw |
| `kid` | signing-key id from the (unverified) token header, on `invalid_token` only |

Volume control: failures always capture; successes are sampled **1 in 20 per
request** (`success_sample_rate` carries the factor). Multiply `outcome=ok`
counts by 20 to estimate true success volume — this is valid **only from the
2026-08-25 fix onward** (see below).

Sampling mechanics (`src/lib/authSampling.ts`, guarded by
`scripts/test-auth-sampling.ts` in `npm run mcp:lint`): each request draws
independently, `Math.random() * 20 < 1`. The draw is deliberately independent
of the token, the user, and the client — that independence is what makes
`ok * 20` an unbiased estimator. A retried request draws again and may be
counted twice; that is correct for a volume estimate and is the price of
unbiasedness.

**Do not make this gate a function of the bearer token.** Two shipped versions
did, and both were biased:

| shipped | mechanism | defect |
| --- | --- | --- |
| 2026-08-23 (launch) | hash of the token's first 64 chars | those chars sit inside the per-instance-constant Clerk JWT header, so every production token hashed identically and the modulus resolved to *never*: **zero** `ok` rows against ~900 successful tool calls |
| 2026-08-24 (PR #81) | hash of the token's signature segment | fixed the constant-hash defect, but still decided **once per token**. A token was always-sampled or never-sampled for life, so a heavy client could contribute zero events regardless of volume. With ~50 active users the token population is small, making this a biased sample over a few tokens rather than a 1-in-20 sample of requests |

The tell for the second defect was clumping: on 2026-08-24, `ok` was zero for
13 consecutive hours (06:00–18:00Z) across a day of continuous traffic
(678 external tool calls), then 40 in the single hour 19:00Z, then clumps and
gaps on 8/25 — while unsampled `no_token` fired every hour throughout,
confirming the endpoint was serving the whole time.

### Historical `ok` counts are not volume — do not multiply them by 20

Any figure derived by multiplying pre-2026-08-25 `ok` counts by 20 is wrong,
and several reports quoted such figures. Correct handling by era:

| era | what `ok` means | how to get volume |
| --- | --- | --- |
| before 2026-08-24T18:10Z | nothing — no `ok` rows exist | use `$mcp_tool_call`, or `no_token` as an activity floor |
| 2026-08-24T18:10Z – 2026-08-25 fix | a biased sample over whichever tokens hashed in; neither a rate nor a floor | use `$mcp_tool_call`; `ok * 20` is meaningless |
| after the 2026-08-25 fix | an unbiased 1-in-20 sample of successful requests | `ok * 20`, ±~2% at daily volumes |

`strategy_used` and `memo_hit` carry the same era caveat: they were only ever
recorded on whichever tokens the old gate happened to admit, so mixes read
before the 2026-08-25 fix are not representative.

The unsampled events (`no_token`, `invalid_token`) were correct throughout and
are the trustworthy series for any historical question.

## 2–3. PostHog alerts (hourly evaluation, email to Ken)

| alert | insight | threshold | rationale |
| --- | --- | --- | --- |
| MCP tool-call volume floor | [MFYwjsQU](https://us.posthog.com/project/343912/insights/MFYwjsQU) | completed day < 50 tool calls | observed daily range 168–1,203 post-launch; near-zero = clients silently locked out |
| MCP invalid_token spike | [mGzUClRs](https://us.posthog.com/project/343912/insights/mGzUClRs) | day (incl. today) > 50 invalid_token failures, **excluding `kid = 'probe'`** | real-user baseline is **0/day**; a spike means verification broke or a rejection storm |

**The invalid_token alert must exclude our own synthetic probes.** Every
`invalid_token` event carrying `kid = 'probe'` comes from
`scripts/mcp-auth-probe.ts`, whose garbage token is minted with
`kid: 'probe'` / `client_id: 'auth-probe'` — see the constant in that file.
`.github/workflows/auth-probe.yml` runs it every 15 min (up to 96/day), so
without the filter the alert pages on its own monitoring: observed probe
invalid_token counts were 7 (8/23), 37 (8/24) and 17 (8/25), already trending
at the threshold of 50.

The documented "0–5/day baseline" predates the probes and was never a
user-traffic figure. **Real user invalid-token volume is 0/day**, so with the
probe filter applied a threshold of 50/day is very loose; treat any sustained
non-probe invalid_token traffic as worth investigating well below it.

Caveat, deliberately recorded: `kid` and `client_id` are read from the
**unverified** token header/payload, so the exclusion filter is spoofable — a
caller could set `kid='probe'` to keep its own 401 storm out of this alert.
That is acceptable here because the alert is a monitoring signal, not an access
control (nothing is authorized on these values; see `unverifiedTokenClaims`).
The compensating control is the tool-call **volume floor** alert, which is
driven by authenticated traffic and cannot be suppressed this way. If probe
contamination ever needs a non-spoofable fix, give the probe its own path or a
dedicated environment rather than trusting a token claim.

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

## 7. Routine checks (named queries)

Run these against PostHog project 343912. Each names the result that means
"healthy" — do not leave a check as "look at PostHog".

**7.1 — Success volume (the corrected estimate).** Valid only for windows
after the 2026-08-25 sampling fix; see the era table in section 1.

```sql
SELECT toStartOfHour(timestamp) AS hour,
       countIf(properties.outcome = 'ok') * 20 AS est_successes,
       countIf(properties.outcome = 'no_token') AS no_token
FROM events
WHERE event = 'mcp_auth_attempt' AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY hour ORDER BY hour
```

Healthy: `est_successes` is non-zero in every hour that carries traffic, and
tracks `$mcp_tool_call` volume within roughly ±20% at hourly granularity.
**Zero `ok` across several consecutive active hours is the exact signature of
the sampling bias returning** — check `src/lib/authSampling.ts` before
concluding the endpoint is down.

**7.2 — Strategy mix and memo hit rate, per client.** This is the check that
`client_id` was missing for; it could not be evaluated per client before
2026-08-25.

```sql
SELECT properties.client_id AS client,
       countIf(properties.memo_hit) / count() AS memo_hit_rate,
       count() AS sampled_attempts
FROM events
WHERE event = 'mcp_auth_attempt' AND properties.outcome = 'ok'
  AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY client HAVING sampled_attempts > 5 ORDER BY sampled_attempts DESC
```

Healthy: repeat clients show `memo_hit_rate` near 1.0. A client stuck near 0
is either newly registered every request or missing the memo — investigate
`strategy_used` for that client. Note counts here are 1-in-20 sampled, so give
a client a few hundred real calls before reading its rate.

**7.3 — Auth failures attributed to a client.** The "clients went silent after
401s" failure mode this instrumentation exists for.

```sql
SELECT properties.client_id AS client, properties.outcome, properties.error_class,
       count() AS n
FROM events
WHERE event = 'mcp_auth_attempt' AND properties.outcome != 'ok'
  AND properties.kid != 'probe'
  AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY client, properties.outcome, properties.error_class ORDER BY n DESC
```

Healthy: no `invalid_token` from a real client (`kid != 'probe'`) — real-user
invalid-token volume is 0/day. `no_token` is expected and benign: it is the
pre-OAuth discovery handshake, not a failure.

**7.4 — Identity-drift self-heal.** Watches the drifted population from
`4b551018` shrink to zero.

```sql
SELECT toDate(timestamp) AS day, count() AS fallbacks, uniq(person_id) AS users
FROM events
WHERE event = 'google_token_identity_fallback' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY day ORDER BY day
```

Healthy: `users` trends to 0 as affected users' next dashboard visit re-syncs
`users.email` to their Clerk primary address. A **rising** count means drift is
still being created — that would be a regression in `clerkPrimaryEmail` /
`resolveDbUser`, not a self-heal. The event is unsampled and independent of
`$mcp_tool_call`, so these counts are exact.
