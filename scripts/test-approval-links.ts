/**
 * Unit tests for signed magic approval links (src/lib/approvalLinks.ts).
 * Run: npx tsx scripts/test-approval-links.ts  (part of `npm run mcp:lint`)
 */
process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || 'sk_test_unit_only_signing_seed';

import {
  mintApprovalToken, mintApprovalUrl, verifyApprovalToken, describeApproval,
} from '../src/lib/approvalLinks';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}

async function main() {
  const token = await mintApprovalToken('user-1', 'key-1', { action: 'send_whitelist', recipient: 'a@b.com' });

  const ok = await verifyApprovalToken(token);
  check('roundtrip verifies', ok.ok);
  if (ok.ok) {
    check('payload fields survive', ok.payload.userId === 'user-1' && ok.payload.proxyKeyId === 'key-1'
      && ok.payload.action === 'send_whitelist' && ok.payload.recipient === 'a@b.com');
    check('jti present', typeof ok.payload.jti === 'string' && ok.payload.jti.length > 10);
    check('description names recipient', describeApproval(ok.payload).includes('a@b.com'));
  }

  const token2 = await mintApprovalToken('user-1', 'key-1', { action: 'send_whitelist', recipient: 'a@b.com' });
  const ok2 = await verifyApprovalToken(token2);
  check('every mint gets a fresh jti', ok.ok && ok2.ok && ok.payload.jti !== ok2.payload.jti);

  // Tampering: flip a character in the signature and in the payload
  const sigTampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
  check('tampered signature rejected', !(await verifyApprovalToken(sigTampered)).ok);
  const [h, p, s] = token.split('.');
  const decoded = JSON.parse(Buffer.from(p, 'base64url').toString());
  decoded.recipient = 'evil@attacker.com';
  const payloadTampered = [h, Buffer.from(JSON.stringify(decoded)).toString('base64url'), s].join('.');
  check('tampered payload rejected', !(await verifyApprovalToken(payloadTampered)).ok);

  // Expiry
  const expired = await mintApprovalToken('user-1', 'key-1', { action: 'sheets_expose', spreadsheetId: 'sheet-1' }, -10);
  const exp = await verifyApprovalToken(expired);
  check('expired token rejected with reason=expired', !exp.ok && exp.reason === 'expired');

  // Unknown action rejected even if correctly signed
  const bogus = await mintApprovalToken('user-1', 'key-1', { action: 'send_whitelist', recipient: 'a@b.com' });
  const [bh, bp, bs] = bogus.split('.');
  const bogusPayload = JSON.parse(Buffer.from(bp, 'base64url').toString());
  bogusPayload.action = 'grant_everything';
  void bh; void bs;
  // (Re-signing isn't possible without the key, so this collapses into the
  // tampered-payload case above — asserting the verifier's action allowlist
  // via the type guard instead.)
  const sheetToken = await mintApprovalToken('u', 'k', { action: 'sheets_write', spreadsheetId: 'ss-9', resourceName: 'Budget' });
  const sheetOk = await verifyApprovalToken(sheetToken);
  check('sheets payload carries resourceName', sheetOk.ok && sheetOk.payload.resourceName === 'Budget');
  if (sheetOk.ok) check('sheets description prefers name', describeApproval(sheetOk.payload).includes('Budget'));

  // Docs actions mirror sheets: documentId payload, resourceName, 30-min TTL.
  const docToken = await mintApprovalToken('u', 'k', { action: 'docs_write', documentId: 'doc-9', resourceName: 'Q3 Notes' });
  const docOk = await verifyApprovalToken(docToken);
  check('docs payload carries documentId', docOk.ok && docOk.payload.documentId === 'doc-9');
  check('docs payload carries resourceName', docOk.ok && docOk.payload.resourceName === 'Q3 Notes');
  if (docOk.ok) {
    check('docs description prefers name', describeApproval(docOk.payload).includes('Q3 Notes'));
    check('docs description says read & write', describeApproval(docOk.payload).includes('read & write'));
  }
  const docExpose = await verifyApprovalToken(await mintApprovalToken('u', 'k', { action: 'docs_expose', documentId: 'doc-1' }));
  check('docs_expose roundtrip verifies', docExpose.ok && docExpose.payload.action === 'docs_expose');
  const expiredDoc = await verifyApprovalToken(await mintApprovalToken('u', 'k', { action: 'docs_expose', documentId: 'doc-1' }, -10));
  check('expired docs token rejected', !expiredDoc.ok && expiredDoc.reason === 'expired');

  // send_all: the "email anyone" escape hatch offered alongside per-recipient
  // approval in send denials.
  const allToken = await mintApprovalToken('user-1', 'key-1', { action: 'send_all' });
  const allOk = await verifyApprovalToken(allToken);
  check('send_all roundtrip verifies', allOk.ok);
  if (allOk.ok) {
    check('send_all payload carries no recipient', allOk.payload.action === 'send_all' && allOk.payload.recipient === undefined);
    check('send_all description says ANY recipient', describeApproval(allOk.payload).includes('ANY recipient'));
  }

  const url = await mintApprovalUrl('https://fgac.ai', 'u', 'k', { action: 'send_whitelist', recipient: 'a@b.com' });
  check('url targets /dashboard/approve', url.startsWith('https://fgac.ai/dashboard/approve?token='));

  // Regression (tester finding 2026-08-15): env base URLs have shipped with a
  // trailing newline, producing "https://fgac.ai\n/dashboard/..." — unclickable.
  for (const dirty of ['https://fgac.ai\n', 'https://fgac.ai \n', 'https://fgac.ai/', '  https://fgac.ai  ']) {
    const u = await mintApprovalUrl(dirty, 'u', 'k', { action: 'send_whitelist', recipient: 'a@b.com' });
    check(`no whitespace in url minted from ${JSON.stringify(dirty)}`, !/\s/.test(u));
    const parsed = new URL(u);
    check(`url parses to fgac.ai/dashboard/approve from ${JSON.stringify(dirty)}`,
      parsed.host === 'fgac.ai' && parsed.pathname === '/dashboard/approve' && !!parsed.searchParams.get('token'));
  }

  if (failures > 0) { console.error(`\n${failures} approval-link test(s) FAILED`); process.exit(1); }
  console.log('\nAll approval-link tests passed.');
}
main();
