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

  // The exact shape Clerk's SDK threw in production 2026-09-08/09 (three
  // accounts, 23 failures, zero recoveries): 400 oauth_token_retrieval_error.
  // The SDK drops meta.provider_error, so the code alone must decide.
  const revoked = Object.assign(new Error('Token retrieval failed'), {
    status: 400, errors: [{ code: 'oauth_token_retrieval_error', message: 'Token retrieval failed', longMessage: 'Failed to retrieve a new access token from the OAuth provider', meta: {} }],
  });
  const rv = classifyClerkTokenError(revoked);
  check('400 oauth_token_retrieval_error → grant_revoked, not retryable', rv.reason === 'grant_revoked' && !rv.retryable);
  check('grant_revoked surfaces status/code, no provider error from the SDK shape', rv.clerkStatus === 400 && rv.clerkCode === 'oauth_token_retrieval_error' && rv.providerError === undefined);
  // What the raw Backend API carried for every affected account.
  const revokedRaw = Object.assign(new Error('Token retrieval failed'), {
    status: 400, errors: [{ code: 'oauth_token_retrieval_error', meta: { provider_error: 'oauth2: "invalid_grant" "Token has been expired or revoked."' } }],
  });
  const rr = classifyClerkTokenError(revokedRaw);
  check('relayed invalid_grant → grant_revoked with providerError kept', rr.reason === 'grant_revoked' && /invalid_grant/.test(rr.providerError ?? ''));
  // A relayed provider error that is explicitly NOT a dead grant stays
  // transient (a Google token-endpoint outage must not mint reconnect links).
  const outage = Object.assign(new Error('Token retrieval failed'), {
    status: 400, errors: [{ code: 'oauth_token_retrieval_error', meta: { provider_error: 'oauth2: "temporarily_unavailable" "The service is currently unavailable"' } }],
  });
  const oc2 = classifyClerkTokenError(outage);
  check('relayed non-invalid_grant provider error → clerk_error, retryable', oc2.reason === 'clerk_error' && oc2.retryable);
  // Clerk's other documented "cannot refresh" code (400).
  const noRefresh = Object.assign(new Error('Missing refresh token'), {
    status: 400, errors: [{ code: 'external_account_missing_refresh_token' }],
  });
  check('external_account_missing_refresh_token → refresh_failed', classifyClerkTokenError(noRefresh).reason === 'refresh_failed');
}

// ---- deterministic boundary --------------------------------------------------

console.log('isDeterministicTokenFailure');
check('no_token is deterministic', isDeterministicTokenFailure('no_token'));
check('refresh_failed is deterministic', isDeterministicTokenFailure('refresh_failed'));
check('clerk_error is NOT deterministic (the production race)', !isDeterministicTokenFailure('clerk_error'));
check('timeout is NOT deterministic', !isDeterministicTokenFailure('timeout'));
check('owner_not_found is deterministic', isDeterministicTokenFailure('owner_not_found'));
check('grant_revoked is deterministic', isDeterministicTokenFailure('grant_revoked'));
check('reconnect repairs no_token / refresh_failed / grant_revoked only', reconnectRepairs('no_token') && reconnectRepairs('refresh_failed') && reconnectRepairs('grant_revoked') && !reconnectRepairs('owner_not_found') && !reconnectRepairs('clerk_error') && !reconnectRepairs('timeout'));

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
  const g = tokenFailureGuidance({ targetEmail: OWNER, keyOwnerEmail: OWNER, reason: 'grant_revoked', reconnectUrl: LINK, retried: false });
  check('grant_revoked → 🚫 Not available yet with denial code', g.text.startsWith('🚫 Not available yet:') && g.denialCode === 'google_token_unavailable');
  check('grant_revoked says Google expired or revoked the access, quoting Google', /expired or revoked/.test(g.text) && /Token has been expired or revoked/.test(g.text));
  check('grant_revoked says STOP / retrying will NOT help', /STOP/.test(g.text) && /retrying will NOT help/.test(g.text));
  check('grant_revoked own-account carries the one-click link for the user', /Send the user this one-click link/.test(g.text) && g.text.includes(LINK));
  check('grant_revoked never says "usually temporary"', !/usually temporary/.test(g.text));
  const d = tokenFailureGuidance({ targetEmail: OWNER, keyOwnerEmail: KEY, reason: 'grant_revoked', reconnectUrl: LINK, retried: false });
  check('grant_revoked delegated → owner must open the link', /forward this one-click link to the owner of/.test(d.text));
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
check('route stamps clerk_code on the tool call (directory error-table split)', /google_token_clerk_code: cls\.clerkCode/.test(route));
check('list_accounts nudges on a reconnect-repairable dead grant', /next_steps: \{[\s\S]*?tokenBroken \? \{[\s\S]*?reconnect:/.test(route) && /tokenBroken = accountDetails\.find\(d => d\.google_token === 'unavailable' && d\.reconnect_url\)/.test(route));
const proxy = readFileSync(join(__dirname, '../src/app/api/proxy/[...path]/route.ts'), 'utf8');
const grantCheck = readFileSync(join(__dirname, '../src/lib/driveFileGrantCheck.ts'), 'utf8');
check('proxy path classifies through the shared helper', /classifyClerkTokenError\(err\)/.test(proxy) && !/\/refresh\/i\.test\(message\) \? 'refresh_failed'/.test(proxy));
check('grant-check path classifies through the shared helper', /classifyClerkTokenError\(err\)/.test(grantCheck) && !/\/refresh\/i\.test\(message\) \? 'refresh_failed'/.test(grantCheck));

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll google-token-failure checks passed');
