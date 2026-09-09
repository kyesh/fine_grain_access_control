/* eslint-disable */
/**
 * Acquisition funnel, Clerk side — COUNTS ONLY, read-only.
 *
 * For every Clerk user created since --since (default 2026-08-10), bucketed by
 * ISO week of creation: how many the app database knows, how many have at least
 * one agent connection (Claude finished OAuth), how many of those carry the
 * Gmail scope on their Google grant, how many carry drive.file, and how many
 * have Sheets/Docs rules. This is the part of the funnel PostHog cannot see:
 * the Google consent checkboxes and the token handoff live in Clerk.
 *
 *   npx tsx scripts/funnel-scopes.ts --prod                 # PRODUCTION (read-only)
 *   npx tsx scripts/funnel-scopes.ts --prod --since 2026-09-01
 *
 * --prod reads .secrets/prod.env (pull it with
 * `npx vercel env pull .secrets/prod.env --environment=production`; delete it
 * when done). Without --prod the development env file and branch database are
 * used, exactly like scripts/google-scope-sweep.ts.
 *
 * Caveat: Clerk's `approved_scopes` is the scope set of the LAST completed
 * OAuth request, so a plain Google sign-in can understate a grant the token
 * still carries (docs/monitoring.md 7.12). Read the scope columns as a floor.
 * Never prints an email, Clerk id, or resource id.
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { neon } from '@neondatabase/serverless';

const PROD = process.argv.includes('--prod');
const sinceIdx = process.argv.indexOf('--since');
const SINCE = Date.parse(sinceIdx > -1 && process.argv[sinceIdx + 1] ? process.argv[sinceIdx + 1] : '2026-08-10');
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

const GMAIL = ['https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/'];
const DRIVE = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'];

type ClerkUser = {
  id: string;
  created_at: number;
  external_accounts: Array<{ provider: string; approved_scopes?: string }>;
};

async function listClerkUsers(secret: string): Promise<ClerkUser[]> {
  const out: ClerkUser[] = [];
  for (let offset = 0; ; offset += 500) {
    const res = await fetch(
      `https://api.clerk.com/v1/users?limit=500&offset=${offset}&order_by=-created_at`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    if (!res.ok) throw new Error(`Clerk list failed: HTTP ${res.status}`);
    const page = (await res.json()) as ClerkUser[];
    out.push(...page);
    // Newest first: stop paging once a page ends before the window.
    if (page.length < 500 || page[page.length - 1].created_at < SINCE) break;
  }
  return out;
}

const weekOf = (ms: number) => {
  const d = new Date(ms);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

async function main() {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) { console.error('CLERK_SECRET_KEY missing'); process.exit(1); }
  const live = secret.startsWith('sk_live_');
  if (PROD && !live) { console.error('REFUSING: --prod requires a LIVE Clerk secret.'); process.exit(1); }
  if (!PROD && live) { console.error('REFUSING: live Clerk secret without --prod.'); process.exit(1); }

  const url = PROD
    ? (process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL)
    : process.env.neon__POSTGRES_URL;
  if (!url) { console.error('No DB URL'); process.exit(1); }
  const sql = neon(url);

  const connections = new Map<string, number>();
  for (const r of (await sql`
    SELECT u.clerk_user_id AS c, count(ac.id)::int AS n
    FROM users u LEFT JOIN agent_connections ac ON ac.user_id = u.id
    WHERE u.deleted_at IS NULL
    GROUP BY u.clerk_user_id
  `) as Array<{ c: string; n: number }>) connections.set(r.c, r.n);

  const services = new Map<string, Set<string>>();
  for (const r of (await sql`
    SELECT u.clerk_user_id AS c, r.service AS s
    FROM access_rules r JOIN users u ON u.id = r.user_id
    GROUP BY u.clerk_user_id, r.service
  `) as Array<{ c: string; s: string }>) {
    if (!services.has(r.c)) services.set(r.c, new Set());
    services.get(r.c)!.add(r.s);
  }

  const users = (await listClerkUsers(secret)).filter(u => u.created_at >= SINCE);
  const blank = () => ({
    clerk_users: 0, in_app_db: 0, connected: 0,
    conn_gmail_scope: 0, conn_drive_scope: 0, conn_sheets_docs_rules: 0,
    conn_no_gmail_scope: 0, conn_rules_without_drive: 0, not_connected: 0,
  });
  const rows: Record<string, ReturnType<typeof blank>> = {};
  for (const u of users) {
    const g = u.external_accounts.find(a => a.provider === 'oauth_google' || a.provider === 'google');
    const scopes = (g?.approved_scopes ?? '').split(/\s+/);
    const gmail = GMAIL.some(s => scopes.includes(s));
    const drive = DRIVE.some(s => scopes.includes(s));
    const conns = connections.get(u.id) ?? 0;
    const svc = services.get(u.id) ?? new Set<string>();
    const rules = svc.has('sheets') || svc.has('docs');
    for (const key of [weekOf(u.created_at), 'TOTAL']) {
      const a = (rows[key] ??= blank());
      a.clerk_users++;
      if (connections.has(u.id)) a.in_app_db++;
      if (conns > 0) {
        a.connected++;
        if (gmail) a.conn_gmail_scope++; else a.conn_no_gmail_scope++;
        if (drive) a.conn_drive_scope++;
        if (rules) { a.conn_sheets_docs_rules++; if (!drive) a.conn_rules_without_drive++; }
      } else {
        a.not_connected++;
      }
    }
  }

  console.log(`Acquisition funnel, Clerk side (${PROD ? 'PRODUCTION' : 'development'}, users created since ${new Date(SINCE).toISOString().slice(0, 10)}) — counts only`);
  console.log('week_of|' + Object.keys(blank()).join('|'));
  for (const k of Object.keys(rows).sort()) console.log(k + '|' + Object.values(rows[k]).join('|'));
  console.log("Read scope columns as floors: Clerk stores the last completed OAuth request's scopes (monitoring.md 7.12).");
}

main().catch(e => { console.error(e); process.exit(1); });
