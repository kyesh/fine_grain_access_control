# Auth Telemetry Sampling Fix — Implementation Plan v1

Branch: `claude/auth-telemetry-sampling-fix` (2026-08-24)

## Problem

Since `mcp_auth_attempt` went live (2026-08-23T15:03Z), production has recorded
51 `no_token` + 21 `invalid_token` events and **zero** `outcome='ok'` events,
against ~900 successful tool calls (expected ~45 at `success_sample_rate=20`).
Consequence: `memo_hit` and `strategy_used` — the PR #79 monitoring deliverable
— are unmeasurable; all captured rows are failures, where both are trivially
`false`/`'none'`.

## Root cause (verified empirically, not just by inspection)

`inSuccessSample()` hashed only the **first 64 characters** of the bearer
token. A Clerk JWT's base64url header segment ({alg, cat, kid, typ}) is ~143
chars — longer than the hash window — and `cat`/`kid` are per-instance
constants. Reproduction with 2,000 structurally-faithful synthetic Clerk JWTs
(one simulated instance, random sub/sid/jti/sig): **exactly 1 distinct hash
value**, `Math.abs(h) % 20 === 3`, so **0/2000 selected**. The "1-in-20
sample" was an all-or-nothing gate keyed to instance constants, and
production's constants landed on "nothing". (A different instance could just
as easily have landed on "everything".)

Alternative explanations ruled out:
- `captureServerEvent` treats real Clerk ids and `'anonymous-mcp'`
  identically (no distinct_id-dependent branch; verified by reading
  `src/lib/posthogServer.ts` — same capture path that lands failures).
- The `ok` branch is reachable: the emission site is shared by all outcomes
  and gated only by `inSuccessSample`; both failure paths verified live
  against the local dev server (401s captured through the same block).
- PostHog-side filtering: nothing in the codebase or project config filters
  the `ok` variant; with the gate mathematically returning false, no
  PostHog-side explanation is needed.

## Changes

1. **`src/lib/authSampling.ts` (new)** — `inSuccessSample` extracted from
   `src/app/api/mcp/route.ts`. Hashes the token's **signature segment**
   (everything after the last `.` — the ~342-char per-token-unique part);
   opaque non-JWT tokens fall back to the whole string. FNV-1a plus a
   murmur3-style avalanche finalizer (a plain 31x prefix hash leaves the
   modulus dominated by trailing chars), unsigned modulus (Math.abs folds two
   residues onto one). Deterministic per token, as before.
2. **`scripts/test-auth-sampling.ts` (new, wired into `npm run mcp:lint`)** —
   asserts on 20k synthetic Clerk-shaped JWTs: selection is not 0%, not 100%,
   within 1pp of 5%; reproduces the old bug's precondition (all tokens share
   their first 64 chars); determinism; spread across users; instance
   independence; opaque-token fallback; other rates; `undefined` ⇒ capture.
3. **`gmail_get_attachment` size attribution** — new `attachment_declared_kb`
   prop stamped from the parent message's MIME metadata *before* the
   attachment fetch, so upstream-failure rows still carry a size.
   (`attachment_chars`/`attachment_kb` remain the measured values on rows
   that reach the fetch; AsyncLocalStorage prop merging verified working by
   direct test, including concurrent-call isolation.)
4. **`classifyToolOutcome`**: ⚠️-prefixed results (only producer: the
   attachment over-cap refusal) now classify as `size_capped` instead of
   `failed` — a deliberate refusal is not a tool error and must not inflate
   `gmail_get_attachment` error-rate readings.
5. **Docs**: `docs/monitoring.md` (sampling mechanics + do-not-regress note),
   `docs/analytics.md` (outcome taxonomy, declared-size prop),
   QA capability 16 (A3 outcome set, A8 attachment props).

## Verification

- `npm run mcp:lint` (includes the new test), `tsc --noEmit`, eslint: clean.
- Local dev server (isolated Neon branch `claude-auth-telemetry-sampling-fix`,
  dev Clerk): bare POST → 401 (`no_token`), well-formed-but-invalid JWT →
  401 (`invalid_token`); both traverse the new emission wiring.
- Success-path (`outcome='ok'` with `strategy_used`/`memo_hit`) needs a real
  OAuth-authenticated MCP client: confirm post-deploy in PostHog (preview via
  /deploy-pr-preview QA, then production). By inspection the emission is
  unchanged — `strategyUsed`/`memoStrategy` are computed before the gate, and
  on `ok` `strategyUsed` is necessarily `clerk` or `direct`.
- PostHog read-back is blocked locally (`POSTHOG_PERSONAL_API_KEY`
  unprovisioned), so pre/post event verification runs through the PostHog MCP
  connector or after the key is provisioned.

## Out of scope (observed, not fixed here)

- A bearer token whose payload segment is not decodable base64 500s instead
  of 401ing (pre-existing; well-formed invalid tokens 401 correctly, and
  production `invalid_token` rows confirm the realistic path works).
- The 100%-null `attachment_kb` on historical production events likely also
  reflects timing: the props first reached main 2026-08-23 14:30Z (PR #78),
  so most/all of the 32 directory-window calls predate the deploy. The
  declared-size stamp makes the property set complete going forward either way.
