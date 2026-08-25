/**
 * Unit tests for mcp_auth_attempt success sampling (src/lib/authSampling.ts).
 * Run: npx tsx scripts/test-auth-sampling.ts  (part of `npm run mcp:lint`)
 *
 * Regression guard for two shipped telemetry defects, both of which made the
 * gate a pure function of the bearer token:
 *   1. 2026-08-23 — hashed a constant token prefix; sampled 0% in production.
 *   2. 2026-08-24 — hashed the token signature; sampled correctly in aggregate
 *      over MANY tokens, but decided once per token, so any single token was
 *      always-in or always-out for life and `ok` counts were biased.
 *
 * The load-bearing assertion is therefore `per-request, not per-token`: one
 * fixed token, sampled many times, must still land at the nominal rate.
 */
import { inSuccessSample, AUTH_SUCCESS_SAMPLE } from '../src/lib/authSampling';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}

const nominal = 100 / AUTH_SUCCESS_SAMPLE;
const draw = (n: number, rate?: number) =>
  Array.from({ length: n }, () => (rate === undefined ? inSuccessSample() : inSuccessSample(rate)))
    .filter(Boolean).length;

function main() {
  const N = 20_000;

  // ---- Rate ----------------------------------------------------------------
  const selected = draw(N);
  const pct = (selected / N) * 100;
  console.log(`  … selected ${selected}/${N} = ${pct.toFixed(2)}% (nominal ${nominal}%)`);
  check('sample is not 0% (the 2026-08-23 production bug)', selected > 0);
  check('sample is not 100%', selected < N);
  // Binomial sd at p=0.05, n=20k is ~0.15pp; ±1pp is ~6.5 sd — tight but not flaky.
  check(`sample is within 1pp of ${nominal}%`, Math.abs(pct - nominal) < 1);

  // ---- The 2026-08-24 bug: per-token determinism ---------------------------
  // Structural guard first: the gate's only parameter is `rate`. A gate that
  // cannot observe the token cannot be a function of it, which is what both
  // shipped defects were. This is the assertion that actually forecloses the
  // regression — a behavioural test cannot feed a token to a gate that takes
  // none, so it would be vacuous.
  check('the gate accepts no token argument (cannot be token-dependent)',
    inSuccessSample.length <= 1);

  // Behavioural corollary: one caller's repeated requests must vary. Under
  // either old implementation this run was all-true or all-false, because the
  // caller's token was fixed.
  const repeatHits = Array.from({ length: N }, () => inSuccessSample()).filter(Boolean).length;
  const repeatPct = (repeatHits / N) * 100;
  console.log(`  … one caller, ${N} requests: ${repeatPct.toFixed(2)}%`);
  check('one caller is neither always-in nor always-out',
    repeatHits > 0 && repeatHits < N);
  check(`repeated requests from one caller sample at ~${nominal}%`,
    Math.abs(repeatPct - nominal) < 1);

  // ---- Independence across heavy vs light callers ---------------------------
  // The bias that mattered: a heavy client contributing zero events. Simulate
  // one caller making 10k requests and 49 making ~200 each; every caller must
  // surface, and share of events must track share of REQUESTS.
  const heavy = draw(10_000);
  const light = Array.from({ length: 49 }, () => draw(200));
  check('a heavy caller contributes events proportional to its volume',
    Math.abs((heavy / 10_000) * 100 - nominal) < 1.5);
  check('light callers are not starved (most surface at least once)',
    light.filter(h => h > 0).length > 49 * 0.8);

  // ---- Unbiasedness of the volume estimate ---------------------------------
  // The property docs/monitoring.md depends on: ok * AUTH_SUCCESS_SAMPLE
  // estimates true request volume.
  const trueVolume = 200_000;
  const estimated = draw(trueVolume) * AUTH_SUCCESS_SAMPLE;
  const errPct = Math.abs(estimated - trueVolume) / trueVolume * 100;
  console.log(`  … volume estimate: ${estimated} vs true ${trueVolume} (${errPct.toFixed(2)}% error)`);
  check('ok * sample_rate estimates true volume within 3%', errPct < 3);

  // ---- Other rates ---------------------------------------------------------
  for (const rate of [2, 5, 100]) {
    const p = (draw(N, rate) / N) * 100;
    check(`rate=${rate} yields ~${(100 / rate).toFixed(1)}% (got ${p.toFixed(2)}%)`,
      Math.abs(p - 100 / rate) < 1.5);
  }

  // ---- Edge cases ----------------------------------------------------------
  check('rate=1 captures everything',
    Array.from({ length: 200 }, () => inSuccessSample(1)).every(Boolean));
  check('rate=0 captures everything (disabled sampling)', inSuccessSample(0));

  if (failures > 0) { console.error(`\n${failures} auth-sampling test(s) FAILED`); process.exit(1); }
  console.log('\nAll auth-sampling tests passed.');
}
main();
