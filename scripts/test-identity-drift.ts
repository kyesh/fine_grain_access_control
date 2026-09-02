/**
 * Unit tests for the identity-drift own-email matcher (src/lib/identityDrift.ts)
 * and a structural guard on the MCP route's drift self-heal.
 * Run: npx tsx scripts/test-identity-drift.ts  (part of `npm run mcp:lint`)
 *
 * Background (2026-08-31 investigation): one production user fired the
 * google_token_identity_fallback on every call for six days because
 * `users.email` held a stale address while their Clerk account was already
 * clean — a single verified PRIMARY address plus the matching Google external
 * account. Two properties of the system made that state permanent:
 *
 *   1. The matcher accepts the PRIMARY verified address (and the Google
 *      external account) — no secondary email is required for the fallback
 *      to keep rescuing calls, so "remove secondary emails" cannot end it.
 *   2. The MCP path only ran `resolveDbUser` for brand-new rows; existing
 *      drifted rows were healed only by dashboard loads, which MCP-only
 *      connector users never perform.
 *
 * The route now heals inside the fallback branch itself; the structural
 * checks below keep that wiring from silently disappearing.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ownClerkEmailMatch } from '../src/lib/identityDrift';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}

const user = (
  emails: Array<[string, string | null]>,
  externals: Array<[string, string | null]> = [],
) => ({
  emailAddresses: emails.map(([emailAddress, status]) => ({
    emailAddress, verification: status === null ? null : { status },
  })),
  externalAccounts: externals.map(([provider, emailAddress]) => ({ provider, emailAddress })),
});

// ---- Matcher behavior ------------------------------------------------------

// The production case: ONE verified primary address, matching Google account,
// drifted users.email elsewhere. The primary itself must satisfy the matcher.
check('verified primary address matches (no secondary required)',
  ownClerkEmailMatch(user([['own@example.com', 'verified']]), 'own@example.com'));

check('match is case-insensitive both ways',
  ownClerkEmailMatch(user([['Own@Example.com', 'verified']]), 'oWn@exAmple.com'));

check('unverified address does not match',
  !ownClerkEmailMatch(user([['own@example.com', 'unverified']]), 'own@example.com'));

check('null verification does not match',
  !ownClerkEmailMatch(user([['own@example.com', null]]), 'own@example.com'));

check('someone else\'s address does not match',
  !ownClerkEmailMatch(user([['own@example.com', 'verified']]), 'other@example.com'));

check('google external account matches even with no email-address entry',
  ownClerkEmailMatch(user([], [['oauth_google', 'own@example.com']]), 'own@example.com'));

check('legacy "google" provider name matches',
  ownClerkEmailMatch(user([], [['google', 'own@example.com']]), 'own@example.com'));

check('non-google external account does not match',
  !ownClerkEmailMatch(user([], [['oauth_github', 'own@example.com']]), 'own@example.com'));

check('external account with no email does not match',
  !ownClerkEmailMatch(user([], [['oauth_google', null]]), 'own@example.com'));

// ---- Structural guard: the fallback branch heals -------------------------
// The heal cannot run behaviourally here (it needs Clerk + the DB), so pin
// the wiring instead: within getGoogleToken, the identity-fallback capture
// must be accompanied by a resolveDbUser call — the self-heal that stops an
// MCP-only user from staying drifted forever.
const route = readFileSync(join(__dirname, '../src/app/api/mcp/route.ts'), 'utf8');
const fnStart = route.indexOf('async function getGoogleToken');
const fnEnd = route.indexOf('\nasync function', fnStart + 1);
const getGoogleTokenSrc = fnStart >= 0 ? route.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined) : '';

check('route.ts still defines getGoogleToken', fnStart >= 0);
check('fallback branch stamps google_token_identity_fallback',
  getGoogleTokenSrc.includes("'google_token_identity_fallback'"));
check('fallback branch heals via resolveDbUser',
  getGoogleTokenSrc.includes('resolveDbUser('));
check('heal is gated on the Clerk primary differing from the DB row',
  getGoogleTokenSrc.includes('primaryEmail.toLowerCase() !== keyOwner.email.toLowerCase()'));

// ---- Structural guard: the heal survives a pre-existing destination row ---
// PR #109's ensureDefaultProfile own-row heal inserts a row for the CURRENT
// users.email on every new connection — for a drifted user that is the STALE
// address, so their key ends up holding rows for both addresses. resolveDbUser's
// re-point must then DELETE the stale row rather than update it into a
// key_email_unique violation, which would abort the heal (and 500 the
// dashboard, whose loadDashboardData calls resolveDbUser unguarded).
const helpers = readFileSync(join(__dirname, '../src/db/userHelpers.ts'), 'utf8');
check('resolveDbUser checks for keys already holding the new-address row',
  helpers.includes('alreadyCurrent'));
check('resolveDbUser deletes the stale row when the destination row exists',
  helpers.includes('delete(keyEmailAccess)'));
check('the delete only touches own-mailbox rows for the old address',
  /delete\(keyEmailAccess\)[\s\S]{0,300}targetEmail, byClerkId\.email[\s\S]{0,200}isNull\(keyEmailAccess\.delegationId\)/.test(helpers));

// ---- Result ----------------------------------------------------------------
if (failures > 0) {
  console.error(`test-identity-drift: ${failures} failure(s)`);
  process.exit(1);
}
console.log('test-identity-drift: all checks passed');
