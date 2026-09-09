/**
 * Unit tests for the approve page's Picker-cancel recovery copy
 * (src/lib/pickerRecoveryCopy.ts).
 * Run: npx tsx scripts/test-picker-recovery-copy.ts  (part of `npm run mcp:lint`)
 *
 * The invariants: a cancel must say nothing changed and offer a retry; the
 * panel must name the file the agent asked for — by title when one is known,
 * by Google id otherwise — and in the id-only case it must tell the user the
 * Picker lists files by NAME (the 2026-09 leak: users saw an opaque id, opened
 * the Picker, and closed it).
 */
import { pickerRecoveryCopy, pickByNameHint, describeRequestedFile, cleanResourceName, pickerAccountHint } from '../src/lib/pickerRecoveryCopy';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}

const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

console.log('pickerRecoveryCopy (id only):');
const idOnly = pickerRecoveryCopy({ short: 'sheet', title: null, fileId: ID });
check('says nothing changed', /Nothing has changed/.test(idOnly.heading));
check('names the kind', /choosing a sheet/.test(idOnly.heading));
check('target carries the Google id', idOnly.target.includes(ID));
check('hint says the picker lists by name, not id', /by name, not by id/.test(idOnly.hint));
check('hint never claims a title it does not have', !/search for "/.test(idOnly.hint));
check('reassurance: any sheet can be picked, mismatch is flagged', /pick any sheet/.test(idOnly.reassurance) && /before anything is approved/.test(idOnly.reassurance));
check('retry label offers the picker again', /Try again/.test(idOnly.retryLabel));

console.log('pickerRecoveryCopy (title known):');
const titled = pickerRecoveryCopy({ short: 'document', title: 'Q3 Budget', fileId: ID });
check('target is the quoted title', titled.target === '"Q3 Budget"');
check('target does not show the id when the title is known', !titled.target.includes(ID));
check('hint says to search for the title', /search for "Q3 Budget"/.test(titled.hint));
check('kind noun follows the input', /choosing a document/.test(titled.heading));

console.log('pickByNameHint:');
check('id-only hint mentions name vs id', /by name, not by id/.test(pickByNameHint({ short: 'sheet', title: null })));
check('titled hint names the title', /"Q3 Budget"/.test(pickByNameHint({ short: 'sheet', title: 'Q3 Budget' })));

console.log('pickerAccountHint:');
const withEmail = pickerAccountHint({ short: 'sheet', googleEmail: 'owner@example.com' });
check('names the connected Google account', withEmail.includes('owner@example.com'));
check('says whose Drive the picker shows', /picker shows the Google Drive of owner@example\.com/.test(withEmail));
check('tells the other-account case to share the file with the connected account', /share it with owner@example\.com/.test(withEmail));
check('says where a shared file appears', /"Shared with me"/.test(withEmail));
check('kind noun follows the input', /If the sheet belongs/.test(withEmail));
const noEmail = pickerAccountHint({ short: 'document', googleEmail: null });
check('unknown account degrades to a generic phrase, never an empty name', /Google account connected to FGAC/.test(noEmail) && !/of \./.test(noEmail));
check('unknown account still gives the share step', /share it with that account/.test(noEmail));
check('unknown account uses the document noun', /If the document belongs/.test(noEmail));

console.log('describeRequestedFile:');
check('id-only wording', describeRequestedFile({ short: 'sheet', title: null, fileId: ID }) === `the sheet with Google id ${ID}`);

console.log('cleanResourceName:');
check('trims and collapses whitespace', cleanResourceName('  Q3   Budget \n ') === 'Q3 Budget');
check('empty → undefined', cleanResourceName('   ') === undefined);
check('non-string → undefined', cleanResourceName(42) === undefined);
check('caps length at 200', (cleanResourceName('x'.repeat(500)) ?? '').length === 200);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll picker recovery copy checks passed.');
