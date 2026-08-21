/**
 * Unit tests for the raw Google API deny-by-default policy
 * (src/app/api/mcp/googleApiPolicy.ts). Run: npx tsx scripts/test-google-api-policy.ts
 */
import {
  classifyGoogleApiCall, extractSendRecipients, collectLabelIds,
  sheetsApprovalAction, docsApprovalAction, extractDocsDocumentId,
  templateGoogleApiPath, rawApiFamily,
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
expect('docs GET document → docs read',
  classifyGoogleApiCall('v1/documents/1AbCdoc', 'GET'),
  (c: { kind: string; documentId?: string; isMutating?: boolean }) =>
    c.kind === 'docs' && c.documentId === '1AbCdoc' && c.isMutating === false);
expect('docs GET with docs/ prefix → docs read',
  classifyGoogleApiCall('docs/v1/documents/1AbCdoc?fields=title', 'GET'),
  (c: { kind: string; documentId?: string }) => c.kind === 'docs' && c.documentId === '1AbCdoc');
expect('docs batchUpdate POST → docs write (verb suffix not part of id)',
  classifyGoogleApiCall('v1/documents/1AbCdoc:batchUpdate', 'POST'),
  (c: { kind: string; documentId?: string; isMutating?: boolean }) =>
    c.kind === 'docs' && c.documentId === '1AbCdoc' && c.isMutating === true);
expect('docs create (no id) POST → docs_create (auto-granted, mirrors sheets_create)',
  classifyGoogleApiCall('v1/documents', 'POST'),
  (c: { kind: string }) => c.kind === 'docs_create');
expect('docs no-id GET → passthrough (Google rejects it, not us)',
  classifyGoogleApiCall('v1/documents', 'GET'),
  (c: { kind: string; family?: string }) => c.kind === 'passthrough' && c.family === 'documents');

console.log('extractDocsDocumentId:');
expect('plain path', extractDocsDocumentId('v1/documents/1AbC_x-9'), (id: string | null) => id === '1AbC_x-9');
expect('batchUpdate verb excluded', extractDocsDocumentId('v1/documents/1AbC:batchUpdate'), (id: string | null) => id === '1AbC');
expect('no id → null', extractDocsDocumentId('v1/documents'), (id: string | null) => id === null);

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

console.log('docsApprovalAction (same matrix as sheets):');
expect('read on unexposed -> docs_expose',
  docsApprovalAction('not_exposed', 'doc1', false),
  (a: { action: string } | null) => a?.action === 'docs_expose');
expect('WRITE on unexposed -> docs_write',
  docsApprovalAction('not_exposed', 'doc1', true),
  (a: { action: string } | null) => a?.action === 'docs_write');
expect('write on read-only -> docs_write',
  docsApprovalAction('read_only', 'doc1', true),
  (a: { action: string } | null) => a?.action === 'docs_write');
expect('blocked mints nothing (read)',
  docsApprovalAction('blocked', 'doc1', false), (a: unknown) => a === null);
expect('blocked mints nothing (write)',
  docsApprovalAction('blocked', 'doc1', true), (a: unknown) => a === null);
expect('documentId carried through',
  docsApprovalAction('not_exposed', 'doc-42', true),
  (a: { documentId?: string } | null) => a?.documentId === 'doc-42');

console.log('templateGoogleApiPath:');
expect('gmail message id → {id}',
  templateGoogleApiPath('gmail/v1/users/me/messages/18c8f2ab91d004a7'),
  (t: string) => t === 'gmail/v1/users/me/messages/{id}');
expect('gmail list (no id) unchanged, query stripped',
  templateGoogleApiPath('gmail/v1/users/me/messages?maxResults=5&q=foo'),
  (t: string) => t === 'gmail/v1/users/me/messages');
expect('gmail attachment id → {id} (both parents)',
  templateGoogleApiPath('/gmail/v1/users/me/messages/18c8f2ab91/attachments/ANGjdJ8w9TfWQzvvMbwFxyz'),
  (t: string) => t === 'gmail/v1/users/me/messages/{id}/attachments/{id}');
expect('gmail user email → {id} (email heuristic)',
  templateGoogleApiPath('gmail/v1/users/someone@example.com/labels'),
  (t: string) => t === 'gmail/v1/users/{id}/labels');
expect('sheets values range with verb → {range}:append',
  templateGoogleApiPath('v4/spreadsheets/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/values/Sheet1!A1:B2:append'),
  (t: string) => t === 'v4/spreadsheets/{id}/values/{range}:append');
expect('sheets column-only range (A:B) fully replaced',
  templateGoogleApiPath('v4/spreadsheets/1BxiM/values/A:B'),
  (t: string) => t === 'v4/spreadsheets/{id}/values/{range}');
expect('sheets %-encoded range → {range}',
  templateGoogleApiPath('v4/spreadsheets/1BxiM/values/Sheet1%21A1%3AB5'),
  (t: string) => t === 'v4/spreadsheets/{id}/values/{range}');
expect('docs batchUpdate keeps verb',
  templateGoogleApiPath('v1/documents/1a2B3c4D5e6F:batchUpdate'),
  (t: string) => t === 'v1/documents/{id}:batchUpdate');
expect('drive file id → {id}',
  templateGoogleApiPath('drive/v3/files/1a2B3c4D5e6F7g8H'),
  (t: string) => t === 'drive/v3/files/{id}');
expect('calendar event under named calendar → {id}s',
  templateGoogleApiPath('calendar/v3/calendars/primary/events/abc123def456'),
  (t: string) => t === 'calendar/v3/calendars/{id}/events/{id}');
expect('short literal segments survive (me, v4, about)',
  templateGoogleApiPath('drive/v3/about'),
  (t: string) => t === 'drive/v3/about');

console.log('rawApiFamily:');
expect('sheets kind → spreadsheets',
  rawApiFamily(classifyGoogleApiCall('v4/spreadsheets/1BxiM/values/A1', 'GET')),
  (f: string | null) => f === 'spreadsheets');
expect('sheets_create → spreadsheets',
  rawApiFamily(classifyGoogleApiCall('v4/spreadsheets', 'POST')),
  (f: string | null) => f === 'spreadsheets');
expect('docs kind → documents',
  rawApiFamily(classifyGoogleApiCall('v1/documents/d1', 'GET')),
  (f: string | null) => f === 'documents');
expect('gmail read → gmail',
  rawApiFamily(classifyGoogleApiCall('gmail/v1/users/me/messages', 'GET')),
  (f: string | null) => f === 'gmail');
expect('gmail send → gmail',
  rawApiFamily(classifyGoogleApiCall('gmail/v1/users/me/messages/send', 'POST')),
  (f: string | null) => f === 'gmail');
expect('passthrough carries classifier family',
  rawApiFamily(classifyGoogleApiCall('calendar/v3/calendars/primary/events', 'GET')),
  (f: string | null) => f === 'calendar/v3');
expect('denied → null',
  rawApiFamily(classifyGoogleApiCall('batch/gmail/v1', 'POST')),
  (f: string | null) => f === null);

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll google-api-policy tests passed.');
