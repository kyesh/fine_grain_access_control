# Auth-health instrumentation fix (v1)

Branch: `claude/relaxed-lederberg-5f78b6` · 2026-08-25

Scope is **telemetry only**. The PR #79 auth optimization (`ec69774`) is
working — `memo_hit=true` on 50/61 sampled successes, `optimizations_enabled=true`,
probes 20/20 — and is not touched here.

## Verification status

The PostHog connector was unavailable for the first part of this task and became
available partway through; **all production claims below were then verified
directly against project 343912**, not taken on trust. Findings:

| claim | verdict |
| --- | --- |
| `uniq(client_id)` = 0 on every `mcp_auth_attempt` | **confirmed** — 0 in all 36 hourly buckets from 8/24 |
| `ok` zero for a long run then clumping | **confirmed** — 0 for 00:00–18:00Z on 8/24 (19 hours), then 40 at 19:00Z |
| sampling is biased per token | **confirmed, and worse than described** — see below |
| invalid_token is all our own probes | **confirmed** — 38 of 39 on 8/24; the one exception was a manual test (`kid='ins_fake'`) |
| `google_token_identity_fallback` event missing | **confirmed** — absent from taxonomy; the tool-call property has also never fired |

**The sampling bias is not a thinned sample.** Because the gate was
deterministic on the token, a token that hashed in was captured on *every*
request. Production shows 63 `ok` events against 55 `$mcp_tool_call` events on
8/24 post-deploy — `ok` exceeding tool calls is impossible under real 1-in-20
sampling — and on 8/25 only 5 of 17 users making tool calls produced any `ok`
event. So `ok` was a near-complete census of a few users plus silence from the
rest, and `ok * 20` overstated the visible users ~20x while scoring everyone
else zero. Net error swung 1.7x (8/24) to ~5x (8/25) depending on who hashed in.

**The identity-drift fallback has never fired in production** since
`4b551018` deployed. The counter therefore starts at zero, and zero is healthy;
it detects *new* drift and cannot recover how many users were rescued earlier.

## Deploy timing — the 19:00Z discontinuity

Asked: is the 8/24 19:00Z jump in `ok` events the PR #81 deploy landing?

**Only partly, and the gap is itself evidence for Bug 1.** From Vercel:

- PR #81 merged `2026-08-24T18:09:29Z` (merge commit `0408c7e`)
- Production deployment created `2026-08-24T18:09:32Z`, build 38s → Ready ≈ `18:10:10Z`

The deploy landed in the **18:00Z** bucket, which recorded **zero** `ok`
events across its ~50 remaining post-deploy minutes. The first events appear an
hour later. So the deploy is the *precondition* (no `ok` row could exist before
it) but does not explain the *timing*: onset waited for the first request from a
token that happened to hash into the sample. Same for the later clumps — that
clumping is the per-token gate's signature, not variation in traffic.

## Fixes

**1. Per-request sampling** (`src/lib/authSampling.ts`). `inSuccessSample()`
loses its token parameter and draws `Math.random() * rate < 1` per request.
Chosen over a counter because a counter needs per-instance state and each cold
start (~6.7%) would restart the cycle and over-represent first-requests-after-boot.
Retries now draw again and may double-count — correct for a volume estimator,
and the old "stable across retries" property is precisely what caused the bias.

**2. `client_id` on `mcp_auth_attempt`** (`route.ts`). Verified `authInfo.clientId`
on success, unverified claim on failure (needed to attribute a 401 storm).
No deliberate privacy reason existed for the omission — the same opaque OAuth
client-registration id already ships on `$mcp_tool_call` and
`mcp_connection_created`, and `docs/analytics.md` already describes it as
opaque. It identifies a client registration, never a person.

*Hardening required by this change*: both unverified claims are
caller-controlled on a failed auth and now flow into analytics, so
`unverifiedTokenClaims` truncates them to 128 chars. Without it an
unauthenticated caller could inflate every event it triggers, and grow
strategy-memo keys without bound (the memo caps entry count, not key length).

**3. `google_token_identity_fallback` event** (`route.ts`). The task said the
signal did not exist; in fact the self-heal already set a tool-call **property**
— but not an event, so the population was not countable independently of
tool-call volume. Adds the standalone event and keeps the property. Chose to add
the counter rather than delete the watch item because the drift population is
exactly what needs to be watched decaying to zero.

**4. invalid_token alert** (docs). Probe exclusion documented with the real
baseline (user invalid_token volume is zero; the "0–5/day" figure predates the
probes). **The PostHog-side insight edit is not done** — see below.

**Docs.** `docs/monitoring.md` gets an era table for which data supports which
estimate, the do-not-do-this history of both bad gates, and a new section 7 of
named queries with stated healthy results. `mcp_auth_attempt` was missing from
`docs/analytics.md` entirely and is now registered along with the new event.

## Not done — needs the user

Editing PostHog insight `mGzUClRs` to exclude `kid = 'probe'` is a change to a
saved alert, so it is left to the user rather than applied from here. The
required filter is documented in `docs/monitoring.md` §2–3. Until it is applied
the alert remains on track to page on our own probes (38/day observed against a
threshold of 50, with GitHub's scheduled-run throttling as the only headroom).

## Validation

`npx tsc --noEmit` clean · `npx eslint` clean · `npm run mcp:lint` passes,
including the rewritten `scripts/test-auth-sampling.ts`. The old suite asserted
`deterministic per token` — the bug — so the load-bearing new assertions are
that the gate accepts no token argument, that one caller's repeated requests
sample at the nominal rate, and that `ok * 20` recovers a known true volume
within 3%.
