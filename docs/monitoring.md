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
| 2026-08-24T18:10Z – 2026-08-25 fix | a near-complete census of a few tokens, plus nothing at all from everyone else | use `$mcp_tool_call`; `ok * 20` overstates by ~20x for the tokens it saw |
| after the 2026-08-25 fix | an unbiased 1-in-20 sample of successful requests | `ok * 20`, ±~2% at daily volumes |

The middle row is the counter-intuitive one and is worth understanding before
reading any report from that window. Because the gate was deterministic on the
token, a token that hashed in was captured on **every single request** — not
one in twenty. So `ok` was not a thinned sample of all traffic; it was an
essentially complete count of a handful of users' requests, and silence from
everyone else. Two measurements from production confirm this:

- **2026-08-24, post-deploy**: 63 `ok` events against 55 `$mcp_tool_call`
  events. `ok` *exceeding* tool calls is impossible under real 1-in-20
  sampling, and is exactly what full capture of a subset predicts.
- **2026-08-25**: only **5 of 17** users who made tool calls produced any `ok`
  event. The other 12 were invisible regardless of how much they called.

Hence `ok * 20` inflated the visible users' traffic roughly twentyfold while
scoring the rest at zero, and the net error swung with who happened to hash in
— about 1.7x too high on 8/24 (63 x 20 = 1,260 against 763 tool calls) and
about 5x on 8/25 (61 x 20 = 1,220 against 247). Treat any number from this
window as unusable rather than merely imprecise.

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
`.github/workflows/auth-probe.yml` schedules it every 15 min (96/day nominal;
GitHub throttles scheduled runs, so observed volume is lower). Measured
2026-08-25, probe share of `invalid_token`:

| day | invalid_token | of which `kid='probe'` |
| --- | --- | --- |
| 8/23 | 10 | 10 |
| 8/24 | 39 | 38 |
| 8/25 (partial) | 18 | 18 |

Without the filter the alert pages on its own monitoring — 38/day against a
threshold of 50, with the only headroom being GitHub's throttling.

**Real user invalid-token volume is 0/day.** The single non-probe event in
three days (8/24 13:00Z) carried `kid='ins_fake'` — a manual test during the
PR #81 work, not a user. The documented "0–5/day baseline" predates the probes
and was never a user-traffic figure. With the probe filter applied a threshold
of 50/day is therefore very loose: treat any sustained non-probe
invalid_token traffic as worth investigating well below it.

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
rises and falls together with `$mcp_tool_call`. Do **not** expect the two to
match: this counts authenticated *requests*, and every MCP request
authenticates (`initialize`, `tools/list`, `ping`, each tool call), so
`est_successes` should sit comfortably **above** tool-call volume. The ratio is
a per-client property of how chatty its MCP session is — establish the normal
ratio empirically before treating a change in it as signal.
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

Healthy: **zero**, which is where it starts. Measured 2026-08-25: the fallback
branch has not fired once in production since `4b551018` deployed — the
`google_token_identity_fallback` tool-call property appears on 0 calls and is
absent from the project taxonomy entirely, and `google_token_fetch_failed` went
7 events / 2 identities on 8/24 to 0 on 8/25. The drifted population appears to
have already self-healed through the dashboard re-sync path.

So this counter is **forward-looking, not retrospective**. It cannot recover how
many users the fallback rescued before it existed; that window has closed. What
it does is make new drift visible: a **rising** count means drift is being
created again, which would be a regression in `clerkPrimaryEmail` /
`resolveDbUser` rather than a self-heal, and is worth investigating at the first
non-zero day. The event is unsampled and independent of `$mcp_tool_call`, so
these counts are exact.
