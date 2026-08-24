/**
 * Unit tests for mcp_auth_attempt success sampling (src/lib/authSampling.ts).
 * Run: npx tsx scripts/test-auth-sampling.ts  (part of `npm run mcp:lint`)
 *
 * Regression guard for the 2026-08-24 telemetry gap: the previous hash read
 * only the first 64 chars of the bearer token, which for a Clerk JWT sit
 * entirely inside the per-instance-constant header — so the "1-in-20 sample"
 * selected either every token or (as in production) none of them.
 */
import crypto from 'node:crypto';
import { inSuccessSample, AUTH_SUCCESS_SAMPLE } from '../src/lib/authSampling';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const rand = (n: number) => crypto.randomBytes(n * 2).toString('base64url').slice(0, n);

/** A structurally faithful Clerk session JWT. No real token is ever used here. */
function clerkJwt(instance: { cat: string; kid: string }, sub: string): string {
  const header = b64u({ alg: 'RS256', cat: instance.cat, kid: instance.kid, typ: 'JWT' });
  const payload = b64u({
    azp: 'https://claude.ai', exp: 1756000060, fva: [0, -1], iat: 1756000000,
    iss: 'https://clerk.fgac.ai', jti: rand(16), nbf: 1755999990,
    sid: `sess_${rand(27)}`, sub, v: 2,
  });
  const sig = crypto.randomBytes(256).toString('base64url'); // RS256 = 256-byte sig
  return `${header}.${payload}.${sig}`;
}

function main() {
  // One Clerk instance mints every production token, so cat/kid are constant.
  const instance = { cat: `cl_${rand(28)}`, kid: `ins_${rand(27)}` };
  const N = 20_000;
  // A realistic population: a modest number of users, many tokens each
  // (Clerk access tokens are short-lived and refresh constantly).
  const users = Array.from({ length: 50 }, () => `user_${rand(27)}`);
  const tokens = Array.from({ length: N }, (_, i) => clerkJwt(instance, users[i % users.length]));

  // The exact shape of the old bug: the first 64 chars are header-only.
  check('Clerk JWT header segment alone exceeds 64 chars (the old hash window)',
    tokens[0].split('.')[0].length > 64);
  check('all tokens share the first 64 chars (why the old hash was constant)',
    new Set(tokens.map(t => t.slice(0, 64))).size === 1);

  const selected = tokens.filter(t => inSuccessSample(t)).length;
  const pct = (selected / N) * 100;
  const nominal = 100 / AUTH_SUCCESS_SAMPLE;
  console.log(`  … selected ${selected}/${N} = ${pct.toFixed(2)}% (nominal ${nominal}%)`);

  // The two failure modes that produced the outage, asserted explicitly.
  check('sample is not 0% (the production bug)', selected > 0);
  check('sample is not 100%', selected < N);
  // Binomial sd at p=0.05, n=20k is ~0.15pp; ±1pp is ~6.5 sd — tight but not flaky.
  check(`sample is within 1pp of ${nominal}%`, Math.abs(pct - nominal) < 1);

  // Determinism: same token in, same answer out. Retries must not double-count.
  check('deterministic per token', tokens.slice(0, 500).every(t => inSuccessSample(t) === inSuccessSample(t)));

  // Selection must track the token, not the user — otherwise a single unlucky
  // user's tokens would carry the whole sample.
  const perUser = new Map<string, { hit: number; total: number }>();
  tokens.forEach((t, i) => {
    const u = users[i % users.length];
    const rec = perUser.get(u) ?? { hit: 0, total: 0 };
    rec.total++; if (inSuccessSample(t)) rec.hit++;
    perUser.set(u, rec);
  });
  const usersWithHits = [...perUser.values()].filter(r => r.hit > 0).length;
  check('sample spreads across users (not concentrated in one)', usersWithHits > users.length * 0.8);

  // A second Clerk instance (different cat/kid) must sample the same way. The
  // old hash's answer was a coin flip decided entirely by these two constants.
  const other = { cat: `cl_${rand(28)}`, kid: `ins_${rand(27)}` };
  const otherTokens = Array.from({ length: N }, (_, i) => clerkJwt(other, users[i % users.length]));
  const otherPct = (otherTokens.filter(t => inSuccessSample(t)).length / N) * 100;
  console.log(`  … second instance: ${otherPct.toFixed(2)}%`);
  check('rate is independent of the Clerk instance constants', Math.abs(otherPct - nominal) < 1);

  // Opaque (non-JWT) bearer tokens still sample, via the whole-token fallback.
  const opaque = Array.from({ length: N }, () => `sk_proxy_${rand(40)}`);
  const opaquePct = (opaque.filter(t => inSuccessSample(t)).length / N) * 100;
  console.log(`  … opaque tokens: ${opaquePct.toFixed(2)}%`);
  check('opaque tokens sample at the nominal rate too', Math.abs(opaquePct - nominal) < 1);

  // Other rates behave.
  for (const rate of [2, 5, 100]) {
    const p = (tokens.filter(t => inSuccessSample(t, rate)).length / N) * 100;
    check(`rate=${rate} yields ~${(100 / rate).toFixed(1)}% (got ${p.toFixed(2)}%)`,
      Math.abs(p - 100 / rate) < 1.5);
  }

  // Edge cases: no token means "always capture" (a missing token is itself the
  // failure being measured), and rate<=1 disables sampling.
  check('undefined token always captures', inSuccessSample(undefined));
  check('rate=1 captures everything', tokens.slice(0, 200).every(t => inSuccessSample(t, 1)));

  if (failures > 0) { console.error(`\n${failures} auth-sampling test(s) FAILED`); process.exit(1); }
  console.log('\nAll auth-sampling tests passed.');
}
main();
