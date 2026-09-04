/**
 * Unit tests for src/lib/googleTokenFailure.ts plus a structural guard on the
 * MCP route's token-fetch retry.
 * Run: npx tsx scripts/test-google-token-failure.ts  (part of `npm run mcp:lint`)
 *
 * Background (2026-09-04 analytics review): one production user's agent hit
 * `google_token_fetch_failed` (reason `clerk_error`) on a DELEGATED mailbox
 * once a day for two weeks, and the tool text told it to reconnect. The
 * per-call sequence showed the failure was a race — a sibling call on the
 * same mailbox ~100 ms away succeeded every time — so the honest answer is
 * "retry" for unknown Clerk errors and "reconnect" only for grant states
 * that cannot clear on their own. These tests pin that boundary, the
 * who-must-reconnect wording for delegated mailboxes, and the outcome
 * prefix each class carries.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  classifyClerkTokenError, isDeterministicTokenFailure, reconnectRepairs, tokenFailureGuidance,
} from '../src/lib/googleTokenFailure';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}

// ---- classifyClerkTokenError ------------------------------------------------

console.log('classifyClerkTokenError');
{
  const t = new Error('timed out after 15000ms'); t.name = 'TimeoutError';
  const c = classifyClerkTokenError(t);
  check('timeout → reason timeout, not retryable', c.reason === 'timeout' && !c.retryable);

  const r = classifyClerkTokenError(new Error('Unable to refresh OAuth token'));
  check('"refresh" in message → refresh_failed, not retryable', r.reason === 'refresh_failed' && !r.retryable);

  const clerkErr = Object.assign(new Error('Unprocessable Entity'), {
    status: 422, errors: [{ code: 'oauth_token_refresh_failed', message: 'x' }],
  });
  const rc = classifyClerkTokenError(clerkErr);
  check('"refresh" in Clerk error code → refresh_failed', rc.reason === 'refresh_failed');
  check('Clerk status/code are surfaced', rc.clerkStatus === 422 && rc.clerkCode === 'oauth_token_refresh_failed');

  const other = Object.assign(new Error('Internal Server Error'), { status: 500, errors: [{ code: 'internal_clerk_error' }] });
  const oc = classifyClerkTokenError(other);
  check('unknown Clerk error → clerk_error, retryable once', oc.reason === 'clerk_error' && oc.retryable);
  check('non-Error rejection still classifies', classifyClerkTokenError('boom').reason === 'clerk_error');

  // The exact shape Clerk returned on the 2026-09-04 preview (production
  // data + dev Clerk instance): the owner's user id does not exist.
  const nf = Object.assign(new Error('Not Found'), {
    status: 404, errors: [{ code: 'resource_not_found', message: 'not found' }],
  });
  const nfc = classifyClerkTokenError(nf);
  check('Clerk 404 resource_not_found → owner_not_found, not retryable', nfc.reason === 'owner_not_found' && !nfc.retryable);
  const nfCodeOnly = Object.assign(new Error('x'), { errors: [{ code: 'resource_not_found' }] });
  check('resource_not_found code alone → owner_not_found', classifyClerkTokenError(nfCodeOnly).reason === 'owner_not_found');
}

// ---- deterministic boundary --------------------------------------------------

console.log('isDeterministicTokenFailure');
check('no_token is deterministic', isDeterministicTokenFailure('no_token'));
check('refresh_failed is deterministic', isDeterministicTokenFailure('refresh_failed'));
check('clerk_error is NOT deterministic (the production race)', !isDeterministicTokenFailure('clerk_error'));
check('timeout is NOT deterministic', !isDeterministicTokenFailure('timeout'));
check('owner_not_found is deterministic', isDeterministicTokenFailure('owner_not_found'));
check('reconnect repairs no_token / refresh_failed only', reconnectRepairs('no_token') && reconnectRepairs('refresh_failed') && !reconnectRepairs('owner_not_found') && !reconnectRepairs('clerk_error'));

// ---- guidance wording ------------------------------------------------------

console.log('tokenFailureGuidance');
const OWNER = 'owner@example.com';
const KEY = 'delegate@example.com';
const LINK = 'https://fgac.example/dashboard/accounts?reconnect=1&for=owner%40example.com';

{
  const g = tokenFailureGuidance({ targetEmail: OWNER, keyOwnerEmail: OWNER, reason: 'clerk_error', reconnectUrl: LINK, retried: true });
  check('transient own-account → ❌ (outcome failed), no denial code', g.text.startsWith('❌') && g.denialCode === undefined);
  check('transient text says retry ONCE before reconnect', /Retry ONCE/.test(g.text) && g.text.indexOf('Retry ONCE') < g.text.indexOf(LINK));
  check('transient text mentions the server-side retry', /retried once/.test(g.text));
  check('transient own-account addresses the user directly', /Send the user this one-click link/.test(g.text));
}
{
  const g = tokenFailureGuidance({ targetEmail: OWNER, keyOwnerEmail: OWNER, reason: 'timeout', reconnectUrl: LINK, retried: false });
  check('timeout → ❌ and says the provider did not answer in time', g.text.startsWith('❌') && /in time/.test(g.text));
  check('timeout text does not claim a retry happened', !/retried once/.test(g.text));
}
{
  const g = tokenFailureGuidance({ targetEmail: OWNER, keyOwnerEmail: KEY, reason: 'no_token', reconnectUrl: LINK, retried: false });
  check('deterministic → 🚫 (outcome denied_by_policy)', g.text.startsWith('🚫 Not available yet:'));
  check('deterministic carries denial code google_token_unavailable', g.denialCode === 'google_token_unavailable');
  check('deterministic says STOP / retrying will NOT help', /STOP/.test(g.text) && /retrying will NOT help/.test(g.text));
  check('delegated: names the owner as the only one who can fix it', /only its owner can repair it/.test(g.text));
  check('delegated: says the key owner cannot fix it from their dashboard', new RegExp(`'${KEY}'\\) cannot fix it`).test(g.text));
  check('delegated: instructs to forward the link to the owner, signed in as that account', /forward this one-click link to the owner of/.test(g.text) && /signed in to FGAC as that account/.test(g.text));
  check('delegated: carries the owner-bound link', g.text.includes(LINK));
}
{
  const g = tokenFailureGuidance({ targetEmail: OWNER, keyOwnerEmail: KEY, reason: 'refresh_failed', reconnectUrl: LINK, retried: false });
  check('refresh_failed → 🚫 with the refresh explanation', g.text.startsWith('🚫') && /refresh token/.test(g.text));
}
{
  const g = tokenFailureGuidance({ targetEmail: OWNER, keyOwnerEmail: KEY, reason: 'clerk_error', reconnectUrl: LINK, retried: true });
  check('transient delegated → still ❌, still retry-first', g.text.startsWith('❌') && /Retry ONCE/.test(g.text));
  check('transient delegated → reconnect fallback names the owner', /forward this one-click link to the owner of/.test(g.text));
}
{
  const g = tokenFailureGuidance({ targetEmail: OWNER, keyOwnerEmail: KEY, reason: 'delegation_inactive', reconnectUrl: LINK, retried: false });
  check('inactive delegation → ❌, no reconnect link (nothing to reconnect)', g.text.startsWith('❌') && !g.text.includes(LINK));
  check('inactive delegation → owner must re-delegate', /re-delegate/.test(g.text) && /Delegations You've Granted/.test(g.text));
}
{
  const g = tokenFailureGuidance({ targetEmail: OWNER, keyOwnerEmail: KEY, reason: 'owner_not_found', reconnectUrl: LINK, retried: false });
  check('owner_not_found → 🚫 with denial code', g.text.startsWith('🚫 Not available yet:') && g.denialCode === 'google_token_unavailable');
  check('owner_not_found → no reconnect link (nothing to reconnect)', !g.text.includes(LINK));
  check('owner_not_found → says the account is missing and a link cannot repair it', /no record of the user/.test(g.text) && /cannot repair a missing account/.test(g.text));
  check('owner_not_found delegated → owner signs in again at the dashboard origin, then re-delegates', g.text.includes('https://fgac.example') && /re-delegate/.test(g.text));
  const own = tokenFailureGuidance({ targetEmail: OWNER, keyOwnerEmail: OWNER, reason: 'owner_not_found', reconnectUrl: LINK, retried: false });
  check('owner_not_found own → user signs in again', /sign in to FGAC again/.test(own.text) && !/re-delegate/.test(own.text));
}
{
  // Case-insensitive own-account match: a key owner stored as Mixed.Case must
  // not be told to "forward the link to the owner" of their own mailbox.
  const g = tokenFailureGuidance({ targetEmail: 'Owner@Example.com', keyOwnerEmail: OWNER, reason: 'no_token', reconnectUrl: LINK, retried: false });
  check('own-account match is case-insensitive', /Send the user this one-click link/.test(g.text));
}

// ---- Structural guard on the route ------------------------------------------

console.log('MCP route wiring');
const route = readFileSync(join(__dirname, '../src/app/api/mcp/route.ts'), 'utf8');
check('route classifies Clerk errors through the shared helper', /classifyClerkTokenError\(/.test(route));
check('route retries a retryable Clerk error once', /google_token_retry/.test(route) && /retryable/.test(route));
check('route builds token-failure text through tokenFailureGuidance', /tokenFailureGuidance\(/.test(route));
check('route stamps denial_code from the guidance (🚫 path)', /denial_code: guidance\.denialCode/.test(route));
check('route no longer emits the old one-size-fits-all token text', !/Could not fetch Google token for/.test(route));

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll google-token-failure checks passed');
