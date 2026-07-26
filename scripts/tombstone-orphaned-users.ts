/* eslint-disable */
/**
 * Retire FGAC users whose Clerk account no longer exists.
 *
 * Clerk accounts that were deleted leave behind rows with live proxy keys and
 * delegations owned by an identity that no longer exists. The `user.deleted`
 * webhook handles this going forward; this backfills what already happened.
 *
 * DRY RUN BY DEFAULT — prints what it would do and changes nothing.
 *
 *   npm run db:tombstone-orphans                    # report, branch DB
 *   npm run db:tombstone-orphans -- --prod          # report, PRODUCTION
 *   npm run db:tombstone-orphans -- --prod --apply  # write, PRODUCTION
 *
 * Report flags:
 *   --mask   hide email local-parts (use when pasting the output somewhere)
 *   --json   machine-readable dump instead of the grouped report
 *
 * Safety, in layers:
 *   - Dry run unless --apply is given, so a write can never happen by omission.
 *   - --prod reads .secrets/prod.env explicitly; production values must never
 *     live in .env.local.
 *   - --prod requires a LIVE Clerk secret. Production user ids do not exist in
 *     the development Clerk instance, so every lookup 404s and every user reads
 *     as deleted.
 *   - Refuses to apply when a majority of users resolve as deleted, which is
 *     far more likely to mean "wrong Clerk instance" than "everyone left".
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');
const MASK = process.argv.includes('--mask');
const JSON_OUT = process.argv.includes('--json');

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

/** Emails are shown in full by default — the point of the report is to let a
 *  human decide whether these are test accounts or real users to notify. */
function shown(email: string): string {
  if (!MASK) return email;
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

function d(v: any): string {
  return v ? new Date(v).toISOString().slice(0, 10) : '—';
}

async function clerkExists(clerkUserId: string, secret: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (res.status === 404) return false;
    if (res.ok) return true;
    console.error(`  ! Clerk lookup failed for ${clerkUserId}: HTTP ${res.status}`);
    return null;
  } catch {
    console.error(`  ! Clerk lookup error for ${clerkUserId}`);
    return null;
  }
}

interface RowPlan {
  id: string;
  email: string;
  clerkUserId: string;
  createdAt: any;
  keyCount: number;
  ruleCount: number;
  connectionCount: number;
  lastActivity: any;
  delIds: string[];
  accCount: number;
}

async function main() {
  const url = PROD
    ? (process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL)
    : process.env.neon__POSTGRES_URL;
  const clerkSecret = process.env.CLERK_SECRET_KEY;

  if (!url) {
    console.error(PROD ? 'No production DB URL in .secrets/prod.env' : 'No branch URL — run `npm run db:branch` first');
    process.exit(1);
  }
  if (!clerkSecret) {
    console.error('CLERK_SECRET_KEY not set — cannot tell deleted accounts from live ones');
    process.exit(1);
  }

  const isLiveKey = clerkSecret.startsWith('sk_live_');
  const isTestKey = clerkSecret.startsWith('sk_test_');

  if (PROD && !isLiveKey) {
    console.error('REFUSING: --prod requires a LIVE Clerk secret (sk_live_...).');
    console.error(`  CLERK_SECRET_KEY here is ${isTestKey ? 'sk_test_ (development instance)' : 'an unrecognised format'}.`);
    console.error('  Production user ids do not exist in the development Clerk instance, so every');
    console.error('  lookup would 404 and every user would be misreported as deleted.');
    process.exit(1);
  }
  if (!PROD && isLiveKey) {
    console.error('REFUSING: live Clerk secret with a branch database — the ids will not match.');
    process.exit(1);
  }

  const sql = neon(url);
  const host = url.split('@')[1]?.split('/')[0] ?? 'unknown';

  if (!JSON_OUT) {
    console.log(`Target : ${host}${PROD ? '  [PRODUCTION]' : '  [branch]'}`);
    console.log(`Clerk  : ${isLiveKey ? 'sk_live (production instance)' : 'sk_test (development instance)'}`);
    console.log(`Mode   : ${APPLY ? 'APPLY — will write' : 'DRY RUN — no changes'}\n`);
  }

  const colCheck = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'deleted_at'
  `;
  const hasDeletedAt = colCheck.length > 0;

  if (!hasDeletedAt) {
    if (!JSON_OUT) {
      console.log('NOTE: users.deleted_at is missing here — migration 0005 has not been applied.');
      console.log('      Reporting anyway; --apply is blocked until it is.\n');
    }
    if (APPLY) {
      console.error('Refusing to --apply without migration 0005. Deploy it first.');
      process.exit(1);
    }
  }

  const candidates = hasDeletedAt
    ? await sql`SELECT id, clerk_user_id, email, created_at FROM users WHERE deleted_at IS NULL ORDER BY email, created_at`
    : await sql`SELECT id, clerk_user_id, email, created_at FROM users ORDER BY email, created_at`;

  // ── Phase 1: PLAN (no writes) ─────────────────────────────────────────────
  const plan: RowPlan[] = [];
  const liveEmails = new Set<string>();
  let unknown = 0, aliveCount = 0;

  for (const u of candidates) {
    const alive = await clerkExists(u.clerk_user_id, clerkSecret);
    if (alive === null) { unknown++; continue; }
    if (alive) { aliveCount++; liveEmails.add(u.email.toLowerCase()); continue; }

    const k = await sql`SELECT count(*)::int AS n FROM proxy_keys WHERE user_id = ${u.id} AND revoked_at IS NULL`;
    const r = await sql`SELECT count(*)::int AS n FROM access_rules WHERE user_id = ${u.id}`;
    const c = await sql`SELECT count(*)::int AS n FROM agent_connections WHERE user_id = ${u.id}`;
    const last = await sql`SELECT max(last_used_at) AS t FROM agent_connections WHERE user_id = ${u.id}`;
    const dOut = await sql`SELECT id FROM email_delegations WHERE owner_user_id = ${u.id} AND status = 'active'`;
    const dIn = await sql`SELECT id FROM email_delegations WHERE delegate_user_id = ${u.id} AND status = 'active'`;
    const delIds = [...dOut, ...dIn].map((x: any) => x.id);
    const acc = delIds.length
      ? await sql`SELECT count(*)::int AS n FROM key_email_access WHERE delegation_id = ANY(${delIds})`
      : [{ n: 0 }];

    plan.push({
      id: u.id, email: u.email, clerkUserId: u.clerk_user_id, createdAt: u.created_at,
      keyCount: k[0].n, ruleCount: r[0].n, connectionCount: c[0].n, lastActivity: last[0].t,
      delIds, accCount: acc[0].n,
    });
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({
      target: host, production: PROD, aliveCount, unknown,
      rows: plan.map(p => ({ ...p, emailStillHasLiveAccount: liveEmails.has(p.email.toLowerCase()) })),
    }, null, 2));
    process.exit(0);
  }

  // ── Grouped report ────────────────────────────────────────────────────────
  // Grouped by email, because the question being answered is "is this a person
  // who lost access, or a test address that was recycled?" — and the strongest
  // signal is whether that address still has a live account.
  const byEmail = new Map<string, RowPlan[]>();
  for (const p of plan) {
    const key = p.email.toLowerCase();
    byEmail.set(key, [...(byEmail.get(key) ?? []), p]);
  }

  const recycled: string[] = [];
  const abandoned: string[] = [];

  for (const [email, rows] of [...byEmail.entries()].sort()) {
    const stillLive = liveEmails.has(email);
    (stillLive ? recycled : abandoned).push(email);

    const carriesState = rows.some(r => r.keyCount || r.ruleCount || r.connectionCount || r.delIds.length);
    const banner = stillLive
      ? 'HAS A LIVE ACCOUNT — old rows only (recycled/re-created)'
      : carriesState
        ? 'NO LIVE ACCOUNT — and this data is not empty ⚠ REVIEW'
        : 'NO LIVE ACCOUNT — nothing attached';

    console.log(`\n${shown(email)}`);
    console.log(`  ${banner}`);
    for (const r of rows) {
      console.log(
        `    row created=${d(r.createdAt)}  clerk=${r.clerkUserId.slice(0, 20)}…  last agent use=${d(r.lastActivity)}`,
      );
      console.log(
        `      keys=${r.keyCount}  rules=${r.ruleCount}  connections=${r.connectionCount}  ` +
        `delegations=${r.delIds.length}  access rows=${r.accCount}`,
      );
    }
  }

  const totals = plan.reduce((a, p) => ({
    keys: a.keys + p.keyCount,
    dels: a.dels + p.delIds.length,
    acc: a.acc + p.accCount,
  }), { keys: 0, dels: 0, acc: 0 });

  console.log(`\n── Summary ──`);
  console.log(`Rows to tombstone  : ${plan.length}  across ${byEmail.size} address(es)`);
  console.log(`Users left alone   : ${aliveCount}`);
  console.log(`Proxy keys revoked : ${totals.keys}`);
  console.log(`Delegations revoked: ${totals.dels}`);
  console.log(`Access rows deleted: ${totals.acc}`);
  if (unknown) console.log(`Skipped (Clerk lookup failed): ${unknown}`);

  console.log(`\n── Who needs attention ──`);
  console.log(`Recycled addresses (still have a live account — no notification needed): ${recycled.length}`);
  for (const e of recycled) console.log(`    ${shown(e)}`);
  console.log(`No live account remains (verify these are test accounts, else notify): ${abandoned.length}`);
  for (const e of abandoned) console.log(`    ${shown(e)}`);

  // ── Sanity gate ───────────────────────────────────────────────────────────
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
  for (const p of plan) {
    const now = new Date().toISOString();
    await sql`UPDATE proxy_keys SET revoked_at = ${now} WHERE user_id = ${p.id} AND revoked_at IS NULL`;
    if (p.delIds.length) {
      await sql`UPDATE email_delegations SET status = 'revoked', revoked_at = ${now} WHERE id = ANY(${p.delIds})`;
      await sql`DELETE FROM key_email_access WHERE delegation_id = ANY(${p.delIds})`;
    }
    await sql`UPDATE users SET deleted_at = ${now}, updated_at = ${now} WHERE id = ${p.id}`;
    console.log(`  ✔ ${shown(p.email)}`);
  }

  process.exit(0);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
