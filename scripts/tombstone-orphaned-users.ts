/* eslint-disable */
/**
 * Retire FGAC users whose Clerk account no longer exists.
 *
 * Clerk accounts that were deleted (commonly: production test accounts deleted
 * and re-created) leave behind rows with live proxy keys and delegations owned
 * by an identity that no longer exists. The `user.deleted` webhook handles this
 * going forward; this backfills what already happened.
 *
 * DRY RUN BY DEFAULT — prints what it would do and changes nothing.
 *
 *   npm run db:tombstone-orphans                    # report, branch DB
 *   npm run db:tombstone-orphans -- --apply         # write, branch DB
 *   npm run db:tombstone-orphans -- --prod          # report, PRODUCTION
 *   npm run db:tombstone-orphans -- --prod --apply  # write, PRODUCTION
 *
 * Safety, in layers:
 *   - Dry run unless --apply is given, so a write can never happen by omission.
 *   - --prod reads .secrets/prod.env explicitly; production values must never
 *     live in .env.local.
 *   - --prod requires a LIVE Clerk secret. Checking production user ids against
 *     the development Clerk instance 404s every lookup and reports every user
 *     as deleted — which would revoke the entire user base.
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');

// Production credentials are read from an explicit path, never from .env.local.
// .env.local holds development credentials; mixing the two is how you end up
// pointed at production without noticing.
const PROD_ENV_PATH = '.secrets/prod.env';

if (PROD) {
  if (!existsSync(PROD_ENV_PATH)) {
    console.error(`--prod requires ${PROD_ENV_PATH}.`);
    console.error(`  npx vercel env pull ${PROD_ENV_PATH} --environment=production`);
    console.error('  (see .secrets/README.md — do not put production values in .env.local)');
    process.exit(1);
  }
  config({ path: PROD_ENV_PATH });
} else {
  config({ path: '.env.local' });
}

import { neon } from '@neondatabase/serverless';

function mask(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

async function clerkExists(clerkUserId: string, secret: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (res.status === 404) return false;
    if (res.ok) return true;
    console.error(`  ! Clerk lookup failed for ${clerkUserId}: HTTP ${res.status}`);
    return null; // unknown — treated as "leave alone"
  } catch (e) {
    console.error(`  ! Clerk lookup error for ${clerkUserId}`);
    return null;
  }
}

async function main() {
  const url = PROD
    ? (process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL)
    : process.env.neon__POSTGRES_URL;
  const clerkSecret = process.env.CLERK_SECRET_KEY;

  if (!url) {
    console.error(PROD ? 'DATABASE_URL_UNPOOLED not set' : 'No branch URL — run `npm run db:branch` first');
    process.exit(1);
  }
  if (!clerkSecret) {
    console.error('CLERK_SECRET_KEY not set — cannot tell deleted accounts from live ones');
    process.exit(1);
  }

  // ── Clerk instance must match the database ────────────────────────────────
  // A user id from the production database will 404 against the *development*
  // Clerk instance, which this script would read as "account deleted" — for
  // EVERY row. Running --apply in that state would revoke every production
  // user's keys and delegations. Refuse outright rather than rely on care.
  const isLiveKey = clerkSecret.startsWith('sk_live_');
  const isTestKey = clerkSecret.startsWith('sk_test_');

  if (PROD && !isLiveKey) {
    console.error('REFUSING: --prod requires a LIVE Clerk secret (sk_live_...).');
    console.error(`  CLERK_SECRET_KEY here is ${isTestKey ? 'sk_test_ (development instance)' : 'an unrecognised format'}.`);
    console.error('  Production user ids do not exist in the development Clerk instance, so every');
    console.error('  lookup would 404 and every user would be misreported as deleted.');
    console.error('  Pull the production key first: npx vercel env pull --environment=production');
    process.exit(1);
  }
  if (!PROD && isLiveKey) {
    console.error('REFUSING: live Clerk secret with a branch database — the ids will not match.');
    process.exit(1);
  }

  const sql = neon(url);
  const host = url.split('@')[1]?.split('/')[0] ?? 'unknown';

  console.log(`Target : ${host}${PROD ? '  [PRODUCTION]' : '  [branch]'}`);
  console.log(`Clerk  : ${isLiveKey ? 'sk_live (production instance)' : 'sk_test (development instance)'}`);
  console.log(`Mode   : ${APPLY ? 'APPLY — will write' : 'DRY RUN — no changes'}\n`);

  // The deleted_at column arrives with migration 0005, which reaches production
  // via CI/CD on merge. Report before it lands (treating every row as live) so
  // the impact can be reviewed ahead of deploying; only block --apply.
  const colCheck = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'deleted_at'
  `;
  const hasDeletedAt = colCheck.length > 0;

  if (!hasDeletedAt) {
    console.log('NOTE: users.deleted_at is missing here — migration 0005 has not been applied.');
    console.log('      Reporting anyway; --apply is blocked until it is.\n');
    if (APPLY) {
      console.error('Refusing to --apply without migration 0005. Deploy it first.');
      process.exit(1);
    }
  }

  const candidates = hasDeletedAt
    ? await sql`SELECT id, clerk_user_id, email, created_at FROM users WHERE deleted_at IS NULL ORDER BY email, created_at`
    : await sql`SELECT id, clerk_user_id, email, created_at FROM users ORDER BY email, created_at`;

  // ── Phase 1: PLAN (no writes) ─────────────────────────────────────────────
  let keys = 0, delegations = 0, accessRows = 0, unknown = 0, aliveCount = 0;
  const plan: { u: any; keyCount: number; delIds: string[]; accCount: number }[] = [];

  for (const u of candidates) {
    const alive = await clerkExists(u.clerk_user_id, clerkSecret);
    if (alive === null) { unknown++; continue; }
    if (alive) { aliveCount++; continue; }

    const k = await sql`SELECT count(*)::int AS n FROM proxy_keys WHERE user_id = ${u.id} AND revoked_at IS NULL`;
    const dOut = await sql`SELECT id FROM email_delegations WHERE owner_user_id = ${u.id} AND status = 'active'`;
    const dIn = await sql`SELECT id FROM email_delegations WHERE delegate_user_id = ${u.id} AND status = 'active'`;
    const delIds = [...dOut, ...dIn].map((d: any) => d.id);
    const acc = delIds.length
      ? await sql`SELECT count(*)::int AS n FROM key_email_access WHERE delegation_id = ANY(${delIds})`
      : [{ n: 0 }];

    keys += k[0].n;
    delegations += delIds.length;
    accessRows += acc[0].n;
    plan.push({ u, keyCount: k[0].n, delIds, accCount: acc[0].n });

    console.log(
      `TOMBSTONE ${mask(u.email)}  clerk=${u.clerk_user_id.slice(0, 18)}…  created=${String(u.created_at).slice(0, 10)}`,
    );
    console.log(`    revoke keys=${k[0].n}  revoke delegations=${delIds.length}  delete access rows=${acc[0].n}`);
  }

  console.log(`\n── Summary ──`);
  console.log(`Users to tombstone : ${plan.length}`);
  console.log(`Users left alone   : ${aliveCount}`);
  console.log(`Proxy keys revoked : ${keys}`);
  console.log(`Delegations revoked: ${delegations}`);
  console.log(`Access rows deleted: ${accessRows}`);
  if (unknown) console.log(`Skipped (Clerk lookup failed): ${unknown}`);

  // ── Sanity gate ───────────────────────────────────────────────────────────
  // A 404 from Clerk cannot distinguish "this account was deleted" from "these
  // ids belong to a different Clerk instance". If NOTHING resolves as alive,
  // the second explanation is overwhelmingly more likely — and acting on it
  // would retire the entire user base. Note the branch database is a copy of
  // main, so its ids are production-instance ids too.
  const checked = plan.length + aliveCount;
  const deletedFraction = checked > 0 ? plan.length / checked : 0;
  const ACKNOWLEDGED = process.argv.includes('--i-verified-the-clerk-instance');

  if (deletedFraction > 0.5 && !ACKNOWLEDGED) {
    console.error(
      `\n🚨 REFUSING TO APPLY: ${plan.length} of ${checked} users (${Math.round(deletedFraction * 100)}%) resolved as deleted.\n` +
      `   A 404 from Clerk cannot tell "this account was deleted" apart from "these ids\n` +
      `   belong to a different Clerk instance". A majority reading as deleted points at\n` +
      `   the second — and acting on it would retire most of the user base.\n` +
      `\n` +
      `   The ${isLiveKey ? 'LIVE' : 'DEVELOPMENT'} Clerk secret is in use. Note the branch database is a\n` +
      `   copy of main, so its user ids are production-instance ids too.\n` +
      `\n` +
      `   Check with \`npm run env:check\`. If the instance really is correct and this\n` +
      `   many accounts really were deleted, re-run with --i-verified-the-clerk-instance.`,
    );
    process.exit(1);
  }

  if (!APPLY) {
    console.log(`\nNothing was written. Re-run with --apply${PROD ? ' --prod' : ''} to execute.`);
    process.exit(0);
  }

  // ── Phase 2: APPLY ────────────────────────────────────────────────────────
  console.log('\nApplying…');
  for (const { u, delIds } of plan) {
    const now = new Date().toISOString();
    await sql`UPDATE proxy_keys SET revoked_at = ${now} WHERE user_id = ${u.id} AND revoked_at IS NULL`;
    if (delIds.length) {
      await sql`UPDATE email_delegations SET status = 'revoked', revoked_at = ${now} WHERE id = ANY(${delIds})`;
      await sql`DELETE FROM key_email_access WHERE delegation_id = ANY(${delIds})`;
    }
    await sql`UPDATE users SET deleted_at = ${now}, updated_at = ${now} WHERE id = ${u.id}`;
    console.log(`  ✔ ${mask(u.email)}`);
  }

  process.exit(0);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
