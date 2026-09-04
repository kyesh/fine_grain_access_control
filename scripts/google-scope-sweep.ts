/* eslint-disable */
/**
 * Google-scope sweep: how many Clerk Google grants carry drive.file, and
 * whether the LAST write to each grant coincided with the user's last sign-in.
 *
 * Background (2026-09-04): Clerk keeps one Google external account per user and
 * rewrites its `approved_scopes` with the scopes of whatever OAuth request last
 * completed. A plain sign-in requests only the dashboard-configured scope set
 * (no drive.file), so a user who granted drive.file through the Picker loses
 * it from Clerk's record the next time they sign in with Google.
 *
 * READ-ONLY. Prints COUNTS ONLY — never an email, Clerk id, or resource id —
 * so the output is safe to paste into a public issue.
 *
 *   npx tsx scripts/google-scope-sweep.ts            # branch DB + dev Clerk
 *   npx tsx scripts/google-scope-sweep.ts --prod     # PRODUCTION (read-only)
 *
 * --prod reads .secrets/prod.env (pull it with
 * `npx vercel env pull .secrets/prod.env --environment=production`, delete it
 * when done). Without --prod the development env file is used.
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';

const PROD = process.argv.includes('--prod');
const PROD_ENV_PATH = '.secrets/prod.env';

if (PROD) {
  if (!existsSync(PROD_ENV_PATH)) {
    console.error(`--prod requires ${PROD_ENV_PATH} (npx vercel env pull ${PROD_ENV_PATH} --environment=production)`);
    process.exit(1);
  }
  config({ path: PROD_ENV_PATH });
} else {
  config({ path: '.env.local' });
}

import { neon } from '@neondatabase/serverless';

const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FULL = 'https://www.googleapis.com/auth/drive';
const GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
const GMAIL_FULL = 'https://mail.google.com/';
// "Written at sign-in": Clerk stamps external_account.updated_at and
// user.last_sign_in_at from the same OAuth callback; allow a few seconds' skew.
const SIGN_IN_WRITE_TOLERANCE_MS = 10_000;

type ClerkUser = {
  id: string;
  last_sign_in_at: number | null;
  external_accounts: Array<{
    provider: string;
    approved_scopes?: string;
    updated_at: number;
    verification?: { status?: string } | null;
  }>;
};

async function listAllClerkUsers(secret: string): Promise<ClerkUser[]> {
  const out: ClerkUser[] = [];
  for (let offset = 0; ; offset += 500) {
    const res = await fetch(
      `https://api.clerk.com/v1/users?limit=500&offset=${offset}&order_by=-last_sign_in_at`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    if (!res.ok) throw new Error(`Clerk list failed: HTTP ${res.status}`);
    const page = (await res.json()) as ClerkUser[];
    out.push(...page);
    if (page.length < 500) break;
  }
  return out;
}

async function main() {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) { console.error('CLERK_SECRET_KEY missing'); process.exit(1); }
  const mode = secret.startsWith('sk_live_') ? 'live' : secret.startsWith('sk_test_') ? 'test' : 'unknown';
  if (PROD && mode !== 'live') { console.error('REFUSING: --prod requires a LIVE Clerk secret.'); process.exit(1); }
  if (!PROD && mode === 'live') { console.error('REFUSING: live Clerk secret without --prod.'); process.exit(1); }

  const url = PROD
    ? (process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL)
    : process.env.neon__POSTGRES_URL;
  if (!url) { console.error('No DB URL'); process.exit(1); }
  const sql = neon(url);

  // Users who have configured Sheets/Docs access (rules or picked files) —
  // the population that actually needs drive.file to work.
  const driveUsers = new Set<string>(
    (await sql`
      SELECT DISTINCT u.clerk_user_id
      FROM access_rules r JOIN users u ON u.id = r.user_id
      WHERE r.service IN ('sheets', 'docs') AND u.deleted_at IS NULL
    `).map((r: any) => r.clerk_user_id as string),
  );

  const users = await listAllClerkUsers(secret);
  const c = {
    users: users.length,
    verifiedGoogle: 0,
    neverSignedIn: 0,
    with: { n: 0, atSignIn: 0, driveUsers: 0, driveUsersAtSignIn: 0 },
    without: { n: 0, atSignIn: 0, gmail: 0, driveUsers: 0, driveUsersAtSignIn: 0 },
  };
  const scopeSetsAtSignIn = new Map<string, number>();
  const scopeSetsOther = new Map<string, number>();

  for (const u of users) {
    const g = u.external_accounts.find(a =>
      (a.provider === 'oauth_google' || a.provider === 'google') && a.verification?.status === 'verified');
    if (!g) continue;
    c.verifiedGoogle++;
    if (!u.last_sign_in_at) c.neverSignedIn++;
    const scopes = (g.approved_scopes ?? '').split(/\s+/).filter(Boolean);
    const hasDrive = scopes.includes(DRIVE_FILE) || scopes.includes(DRIVE_FULL);
    const hasGmail = scopes.includes(GMAIL_MODIFY) || scopes.includes(GMAIL_FULL);
    const atSignIn = !!u.last_sign_in_at &&
      Math.abs(g.updated_at - u.last_sign_in_at) <= SIGN_IN_WRITE_TOLERANCE_MS;
    const isDriveUser = driveUsers.has(u.id);
    const key = scopes.map(s => s.replace('https://www.googleapis.com/auth/', '')).sort().join(' ');
    const bucket = atSignIn ? scopeSetsAtSignIn : scopeSetsOther;
    bucket.set(key, (bucket.get(key) ?? 0) + 1);

    const b = hasDrive ? c.with : c.without;
    b.n++;
    if (atSignIn) b.atSignIn++;
    if (isDriveUser) { b.driveUsers++; if (atSignIn) b.driveUsersAtSignIn++; }
    if (!hasDrive && hasGmail) c.without.gmail++;
  }

  console.log(`Google scope sweep (${PROD ? 'PRODUCTION' : 'dev'}, Clerk ${mode}) — counts only\n`);
  console.log(`Clerk users: ${c.users}   verified Google accounts: ${c.verifiedGoogle}   (never signed in: ${c.neverSignedIn})`);
  console.log(`Users with Sheets/Docs rules in DB: ${driveUsers.size}\n`);
  console.log('                       accounts   grant last written at last sign-in   have Sheets/Docs rules (of which written at sign-in)');
  console.log(`WITH drive.file        ${String(c.with.n).padStart(8)}   ${String(c.with.atSignIn).padStart(34)}   ${String(c.with.driveUsers).padStart(8)} (${c.with.driveUsersAtSignIn})`);
  console.log(`WITHOUT drive.file     ${String(c.without.n).padStart(8)}   ${String(c.without.atSignIn).padStart(34)}   ${String(c.without.driveUsers).padStart(8)} (${c.without.driveUsersAtSignIn})`);
  console.log(`  (WITHOUT drive.file but with a Gmail scope: ${c.without.gmail})\n`);
  console.log('Scope sets on grants last written at sign-in (what a sign-in requests):');
  for (const [k, n] of [...scopeSetsAtSignIn].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log('Scope sets on all other grants:');
  for (const [k, n] of [...scopeSetsOther].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log(`\nBROKEN NOW: ${c.without.driveUsers} users have Sheets/Docs configured but no drive.file on the Clerk grant.`);
}

main().catch(e => { console.error(e); process.exit(1); });
