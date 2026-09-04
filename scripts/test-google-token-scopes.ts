/**
 * Unit tests for the MCP scope pre-flight decision (src/lib/googleTokenScopes.ts).
 * Run: npx tsx scripts/test-google-token-scopes.ts  (part of `npm run mcp:lint`)
 *
 * The invariant (2026-09-04): Clerk's recorded scopes are a cache of the last
 * OAuth request that completed, and a plain Google sign-in rewrites them
 * without drive.file. When the record shows a gap, the token's live scopes
 * decide; when the record is complete, tokeninfo is never consulted; and a
 * tokeninfo outage leaves the record's verdict in place.
 */
import { reconcileScopes } from '../src/lib/googleTokenScopes';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}

const GMAIL = 'https://www.googleapis.com/auth/gmail.modify';
const DRIVE = 'https://www.googleapis.com/auth/drive.file';
const BASE = ['openid', 'email', 'profile'];

console.log('reconcileScopes:');

const full = reconcileScopes([...BASE, GMAIL, DRIVE], null);
check('complete record: both scopes granted, no live lookup needed',
  full.hasGmailScope === true && full.hasDriveFileScope === true && !full.needsLive && !full.recordStale);

const narrow = reconcileScopes([...BASE, GMAIL], null);
check('narrow record without tokeninfo: needs live, record stands (drive missing)',
  narrow.needsLive && narrow.hasDriveFileScope === false && narrow.hasGmailScope === true && !narrow.recordStale);

const healed = reconcileScopes([...BASE, GMAIL], [...BASE, GMAIL, DRIVE]);
check('narrow record but wide token (post-sign-in refresh): drive granted, record flagged stale',
  healed.hasDriveFileScope === true && healed.hasGmailScope === true && healed.recordStale);

const stillNarrow = reconcileScopes([...BASE, GMAIL], [...BASE, GMAIL]);
check('narrow record and narrow token (first hour after sign-in): drive denied, not stale',
  stillNarrow.hasDriveFileScope === false && !stillNarrow.recordStale);

const revoked = reconcileScopes([...BASE, DRIVE], [...BASE]);
check('live token narrower than record: never widened by the record',
  revoked.hasDriveFileScope === false && revoked.hasGmailScope === false && !revoked.recordStale);

const unknown = reconcileScopes(undefined, [...BASE, GMAIL, DRIVE]);
check('no record at all: undefined verdicts (never enforce), live ignored',
  unknown.hasGmailScope === undefined && unknown.hasDriveFileScope === undefined && !unknown.needsLive);

const fullDrive = reconcileScopes([...BASE, 'https://mail.google.com/', 'https://www.googleapis.com/auth/drive'], null);
check('legacy full-Gmail and full-Drive scopes satisfy both', fullDrive.hasGmailScope === true && fullDrive.hasDriveFileScope === true);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll google-token-scopes checks passed.');
