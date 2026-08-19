/**
 * Unit tests for the raw Google API deny-by-default policy
 * (src/app/api/mcp/googleApiPolicy.ts). Run: npx tsx scripts/test-google-api-policy.ts
 */
import {
  classifyGoogleApiCall, extractSendRecipients, collectLabelIds, sheetsApprovalAction,
} from '../src/app/api/mcp/googleApiPolicy';

let failures = 0;
function expect(name: string, actual: unknown, predicate: (v: never) => boolean) {
  if (!predicate(actual as never)) {
    failures++;
    console.error(`  ✗ ${name} — got: ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
}

console.log('classifyGoogleApiCall:');
expect('gmail GET list → gmail_read',
  classifyGoogleApiCall('gmail/v1/users/me/messages?maxResults=5', 'GET'),
  (c: { kind: string }) => c.kind === 'gmail_read');
expect('gmail GET message → gmail_read',
  classifyGoogleApiCall('/gmail/v1/users/me/messages/abc123', 'GET'),
  (c: { kind: string }) => c.kind === 'gmail_read');
expect('gmail send POST → gmail_send',
  classifyGoogleApiCall('gmail/v1/users/me/messages/send', 'POST'),
  (c: { kind: string }) => c.kind === 'gmail_send');
expect('gmail send with query → gmail_send',
  classifyGoogleApiCall('gmail/v1/users/me/messages/send?alt=json', 'POST'),
  (c: { kind: string }) => c.kind === 'gmail_send');
expect('gmail modify POST → denied',
  classifyGoogleApiCall('gmail/v1/users/me/messages/abc/modify', 'POST'),
  (c: { kind: string }) => c.kind === 'denied');
expect('gmail settings forwarding POST → denied',
  classifyGoogleApiCall('gmail/v1/users/me/settings/forwardingAddresses', 'POST'),
  (c: { kind: string }) => c.kind === 'denied');
expect('gmail drafts POST → denied',
  classifyGoogleApiCall('gmail/v1/users/me/drafts', 'POST'),
  (c: { kind: string }) => c.kind === 'denied');
expect('gmail trash DELETE-ish POST → denied',
  classifyGoogleApiCall('gmail/v1/users/me/messages/abc/trash', 'POST'),
  (c: { kind: string }) => c.kind === 'denied');
expect('sheets GET values → sheets read',
  classifyGoogleApiCall('v4/spreadsheets/1BxiM/values/Sheet1', 'GET'),
  (c: { kind: string; spreadsheetId?: string; isMutating?: boolean }) =>
    c.kind === 'sheets' && c.spreadsheetId === '1BxiM' && c.isMutating === false);
expect('sheets append POST → sheets write',
  classifyGoogleApiCall('sheets/v4/spreadsheets/1BxiM/values/Sheet1:append', 'POST'),
  (c: { kind: string; isMutating?: boolean }) => c.kind === 'sheets' && c.isMutating === true);
expect('sheets create (no id) POST → sheets_create (2026-08-19: creation allowed, auto-granted)',
  classifyGoogleApiCall('v4/spreadsheets', 'POST'),
  (c: { kind: string }) => c.kind === 'sheets_create');
expect('sheets no-id GET → passthrough (Google rejects it, not us)',
  classifyGoogleApiCall('v4/spreadsheets', 'GET'),
  (c: { kind: string; family?: string }) => c.kind === 'passthrough' && c.family === 'spreadsheets');
expect('batch endpoint → denied',
  classifyGoogleApiCall('batch/gmail/v1', 'POST'),
  (c: { kind: string }) => c.kind === 'denied');
expect('unknown API (drive) → passthrough with family (classify, not block)',
  classifyGoogleApiCall('drive/v3/files', 'GET'),
  (c: { kind: string; family?: string }) => c.kind === 'passthrough' && c.family === 'drive/v3');
expect('unknown API (calendar) → passthrough with family',
  classifyGoogleApiCall('calendar/v3/calendars/primary/events', 'GET'),
  (c: { kind: string; family?: string }) => c.kind === 'passthrough' && c.family === 'calendar/v3');

console.log('extractSendRecipients:');
const raw = Buffer.from(
  'To: alice@example.com\r\nCc: Bob <bob@example.org>\r\nSubject: hi\r\n\r\nBody mentions carol@nowhere.test',
).toString('base64url');
expect('parses To and Cc, ignores body',
  extractSendRecipients({ raw }),
  (r: string[] | null) => !!r && r.length === 2 && r.includes('alice@example.com') && r.includes('bob@example.org'));
expect('JSON string body works',
  extractSendRecipients(JSON.stringify({ raw })),
  (r: string[] | null) => !!r && r.includes('alice@example.com'));
expect('missing raw → null', extractSendRecipients({ foo: 1 }), (r: unknown) => r === null);
expect('garbage → null', extractSendRecipients('not json'), (r: unknown) => r === null);
const foldedRaw = Buffer.from(
  'To: alice@example.com,\r\n bob@example.org\r\nSubject: folded\r\n\r\nx',
).toString('base64url');
expect('unfolds continuation lines',
  extractSendRecipients({ raw: foldedRaw }),
  (r: string[] | null) => !!r && r.includes('bob@example.org'));

console.log('collectLabelIds:');
expect('top-level labels',
  collectLabelIds({ labelIds: ['INBOX', 'SECRET'] }),
  (l: string[]) => l.includes('SECRET'));
expect('nested thread messages',
  collectLabelIds({ messages: [{ labelIds: ['INBOX'] }, { labelIds: ['SECRET'] }] }),
  (l: string[]) => l.includes('SECRET') && l.includes('INBOX'));
expect('no labels → empty', collectLabelIds({ messages: [{ id: 'a' }] }), (l: string[]) => l.length === 0);

console.log('sheetsApprovalAction (denial -> approval action matrix):');
// Regression (tester finding 2026-08-15): a WRITE denied on an unexposed
// sheet must mint a write-level token — a read-only exposure under-grants
// and traps the user in an approve/retry/fail loop.
expect('read on unexposed -> sheets_expose',
  sheetsApprovalAction('not_exposed', 'ss1', false),
  (a: { action: string } | null) => a?.action === 'sheets_expose');
expect('WRITE on unexposed -> sheets_write',
  sheetsApprovalAction('not_exposed', 'ss1', true),
  (a: { action: string } | null) => a?.action === 'sheets_write');
expect('write on read-only -> sheets_write',
  sheetsApprovalAction('read_only', 'ss1', true),
  (a: { action: string } | null) => a?.action === 'sheets_write');
expect('blocked mints nothing (read)',
  sheetsApprovalAction('blocked', 'ss1', false), (a: unknown) => a === null);
expect('blocked mints nothing (write)',
  sheetsApprovalAction('blocked', 'ss1', true), (a: unknown) => a === null);
expect('spreadsheetId carried through',
  sheetsApprovalAction('not_exposed', 'ss-42', true),
  (a: { spreadsheetId?: string } | null) => a?.spreadsheetId === 'ss-42');

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll google-api-policy tests passed.');
