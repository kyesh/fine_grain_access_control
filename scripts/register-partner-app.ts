/**
 * Register (or update) a partner application: creates the pre-registered Clerk
 * OAuth application with consent_screen_enabled=false (FGAC's /oauth/authorize
 * interstitial is the ONLY consent screen) AND the partner_apps registry row.
 *
 * Per-environment by design — dev and prod Clerk are separate instances, so a
 * partner must be registered in each. Dev is the default; production requires
 * BOTH --prod and --apply and reads .secrets/prod.env by name (repo convention:
 * see scripts/tombstone-orphaned-users.ts and CLAUDE.md → Production
 * Credentials).
 *
 * Usage (dev):
 *   npx tsx scripts/register-partner-app.ts \
 *     --name "Data Driven Job Search" \
 *     --redirect-uri https://ddjs.example.com/fgac/callback \
 *     --webhook-url https://api.ddjs.example.com/fgac/webhook \
 *     --notifications
 *
 * Prints the client credentials ONCE — hand them to the partner over a secure
 * channel; the client_secret is not stored by FGAC outside Clerk.
 */
import { config } from 'dotenv';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const optAll = (name: string): string[] => {
  const out: string[] = [];
  args.forEach((a, i) => { if (a === `--${name}` && args[i + 1]) out.push(args[i + 1]); });
  return out;
};

const isProd = flag('prod');
if (isProd && !flag('apply')) {
  console.error('--prod requires --apply (explicit write consent). Aborting.');
  process.exit(1);
}
config({ path: isProd ? '.secrets/prod.env' : '.env.local' });

async function main() {
  const name = opt('name');
  const redirectUris = optAll('redirect-uri');
  if (!name || redirectUris.length === 0) {
    console.error('Required: --name <app name> --redirect-uri <uri> [--redirect-uri <uri2>] [--webhook-url <url>] [--logo-url <url>] [--notifications] [--prod --apply]');
    process.exit(1);
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY not found in environment file');
  if (isProd && !secretKey.startsWith('sk_live_')) throw new Error('--prod given but key is not sk_live_');
  if (!isProd && !secretKey.startsWith('sk_test_')) throw new Error('dev mode but key is not sk_test_ — refusing');

  // Late import so dotenv runs first; src/db enforces branch isolation in dev.
  const { db } = await import('../src/db');
  const { partnerApps } = await import('../src/db/schema');

  const manifest = {
    services: ['gmail'],
    access: 'read_only',
    rule_templates: [],
    ...(flag('notifications') ? { notifications: { trigger: 'new_email' } } : {}),
  };

  const existing = await db.query.partnerApps.findFirst({
    where: eq(partnerApps.name, name),
  });

  let clientId: string; let clientSecret: string | null = null; let clerkAppId: string;

  if (existing?.clerkOauthAppId) {
    // Update path: sync redirect URIs on the existing Clerk app.
    const res = await fetch(`https://api.clerk.com/v1/oauth_applications/${existing.clerkOauthAppId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: redirectUris, consent_screen_enabled: false }),
    });
    if (!res.ok) throw new Error(`Clerk PATCH failed: ${res.status} ${await res.text()}`);
    const app = await res.json();
    clientId = app.client_id; clerkAppId = app.id;
  } else {
    const res = await fetch('https://api.clerk.com/v1/oauth_applications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        redirect_uris: redirectUris,
        scopes: 'profile email offline_access',
        consent_screen_enabled: false,
        public: false,
      }),
    });
    if (!res.ok) throw new Error(`Clerk POST failed: ${res.status} ${await res.text()}`);
    const app = await res.json();
    clientId = app.client_id; clientSecret = app.client_secret; clerkAppId = app.id;
  }

  const webhookSecret = crypto.randomBytes(32).toString('hex');
  const values = {
    clientId,
    clerkOauthAppId: clerkAppId,
    name,
    logoUrl: opt('logo-url') ?? null,
    manifest,
    redirectUris,
    webhookUrl: opt('webhook-url') ?? null,
    status: 'active',
    updatedAt: new Date(),
  };

  if (existing) {
    // Manifest changes bump the version — existing connections stay pinned to
    // the version they consented to (no silent widening).
    const manifestChanged = JSON.stringify(existing.manifest) !== JSON.stringify(manifest);
    await db.update(partnerApps).set({
      ...values,
      ...(manifestChanged ? { manifestVersion: existing.manifestVersion + 1 } : {}),
      // Keep the original webhook secret unless explicitly rolled.
      ...(flag('roll-webhook-secret') ? { webhookSecret } : {}),
    }).where(eq(partnerApps.id, existing.id));
    console.log(`Updated partner app '${name}' (client_id=${clientId})${manifestChanged ? ` — manifestVersion bumped to ${existing.manifestVersion + 1}` : ''}`);
    if (flag('roll-webhook-secret')) console.log(`New webhook secret: ${webhookSecret}`);
  } else {
    await db.insert(partnerApps).values({ ...values, webhookSecret });
    console.log(`Registered partner app '${name}'`);
    console.log(`  client_id:      ${clientId}`);
    if (clientSecret) console.log(`  client_secret:  ${clientSecret}   <-- hand to partner ONCE, not stored`);
    console.log(`  webhook_secret: ${webhookSecret}   <-- partner verifies X-FGAC-Signature with this`);
    console.log(`  authorize URL:  <app-host>/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUris[0])}&response_type=code&state=...`);
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
