/**
 * Unit tests for the MCP scope pre-flight decision (src/lib/googleTokenScopes.ts).
 * Run: npx tsx scripts/test-google-token-scopes.ts  (part of `npm run mcp:lint`)
 *
 * The invariant (2026-09-04): Clerk's recorded scopes are a cache of the last
 * OAuth request that completed, and they disagree with the token in both
 * directions — narrower after a plain sign-in whose scope list lacked
 * drive.file, wider after a no-consent sign-in over a narrow refresh token.
 * The token's live scopes decide whenever tokeninfo answers; a tokeninfo
 * outage leaves the record's verdict in place.
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

const agree = reconcileScopes([...BASE, GMAIL, DRIVE], [...BASE, GMAIL, DRIVE]);
check('record and token agree: both granted, nothing flagged',
  agree.hasGmailScope === true && agree.hasDriveFileScope === true && !agree.recordStale && !agree.recordOverstates && agree.source === 'token');

const healed = reconcileScopes([...BASE, GMAIL], [...BASE, GMAIL, DRIVE]);
check('narrow record, wide token (refresh over a wide refresh token): drive granted, record flagged stale',
  healed.hasDriveFileScope === true && healed.recordStale && !healed.recordOverstates);

const overstated = reconcileScopes([...BASE, GMAIL, DRIVE], [...BASE, GMAIL]);
check('wide record, narrow token (no-consent sign-in over a narrow refresh token): drive DENIED, record flagged overstating',
  overstated.hasDriveFileScope === false && overstated.hasGmailScope === true && overstated.recordOverstates && !overstated.recordStale);

const stillNarrow = reconcileScopes([...BASE, GMAIL], [...BASE, GMAIL]);
check('narrow record and narrow token: drive denied, nothing flagged',
  stillNarrow.hasDriveFileScope === false && !stillNarrow.recordStale && !stillNarrow.recordOverstates);

const outage = reconcileScopes([...BASE, GMAIL], null);
check('tokeninfo unavailable: the record stands (drive missing), source = record',
  outage.hasDriveFileScope === false && outage.hasGmailScope === true && outage.source === 'record' && !outage.recordStale && !outage.recordOverstates);

const outageWide = reconcileScopes([...BASE, GMAIL, DRIVE], null);
check('tokeninfo unavailable with a complete record: record stands (both granted)',
  outageWide.hasDriveFileScope === true && outageWide.hasGmailScope === true);

const noRecordLive = reconcileScopes(undefined, [...BASE, GMAIL, DRIVE]);
check('no record but tokeninfo answers: the token decides, nothing flagged',
  noRecordLive.hasGmailScope === true && noRecordLive.hasDriveFileScope === true && !noRecordLive.recordStale && !noRecordLive.recordOverstates);

const nothing = reconcileScopes(undefined, null);
check('no record and no tokeninfo: undefined verdicts (never enforce), source = none',
  nothing.hasGmailScope === undefined && nothing.hasDriveFileScope === undefined && nothing.source === 'none');

const fullDrive = reconcileScopes(null as unknown as undefined, [...BASE, 'https://mail.google.com/', 'https://www.googleapis.com/auth/drive']);
check('legacy full-Gmail and full-Drive scopes on the token satisfy both', fullDrive.hasGmailScope === true && fullDrive.hasDriveFileScope === true);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll google-token-scopes checks passed.');
