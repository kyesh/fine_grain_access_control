/**
 * Manage QR/flyer short links (fgac.ai/go/<slug>).
 *
 *   npm run links -- list
 *   npm run links -- add umich-kiosk-u --dest /setup --campaign fall26 --variant u --channel umich-kiosk --notes "Diag kiosks, utility headline"
 *   npm run links -- retarget umich-kiosk-u --dest https://claude.ai/directory/fgac-ai
 *   npm run links -- remove umich-kiosk-u
 *
 * Suggested slug scheme (keep them short — shorter slug = sparser QR):
 *   <campus>-<channel>-<headline variant>[-<destination variant>]
 *   e.g. emu-boards-s, umich-kiosk-u-d ("-d" = points at the directory).
 *
 * Targets the isolated branch DB (.env.local) by default. Production, per the
 * repo's production-credentials rules:
 *
 *   npx vercel env pull .secrets/prod.env --environment=production
 *   npm run links -- list --prod                 # reads are fine
 *   npm run links -- add ... --prod --apply      # writes need BOTH flags
 *
 * Without --apply a --prod write prints what it would do and exits. Reprint
 * nothing: to repoint a printed QR, `retarget` the slug — the scan counter and
 * history survive. `remove` deletes the row (and its counter) permanently.
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');

const PROD_ENV_PATH = '.secrets/prod.env';
if (PROD) {
  if (!existsSync(PROD_ENV_PATH)) {
    console.error(`--prod requires ${PROD_ENV_PATH}.`);
    console.error(`  npx vercel env pull ${PROD_ENV_PATH} --environment=production`);
    process.exit(1);
  }
  config({ path: PROD_ENV_PATH });
} else {
  config({ path: '.env.local' });
}

import { neon } from '@neondatabase/serverless';

function connectionString(): string {
  // Branch DB locally (written by `npm run db:branch`); POSTGRES_URL when
  // explicitly pointed at production via --prod + .secrets/prod.env.
  const url = PROD ? process.env.POSTGRES_URL : process.env.neon__POSTGRES_URL;
  if (!url) {
    console.error(
      PROD
        ? 'POSTGRES_URL missing from .secrets/prod.env — re-pull it.'
        : 'neon__POSTGRES_URL missing — run `npm run db:branch` first.',
    );
    process.exit(1);
  }
  return url;
}

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  const value = i >= 0 ? args[i + 1] : undefined;
  // A following flag means the value was omitted — fail validation instead of
  // silently storing "--campaign" as a destination.
  return value?.startsWith('--') ? undefined : value;
}

// Slugs must survive as a URL path segment and match the route's lowercase
// lookup; destinations must be a site-relative path or an absolute http(s)
// URL — anything else prints a QR that 404s or 500s after it's on a wall.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function validDestination(dest: string): boolean {
  if (dest.startsWith('//')) return false; // protocol-relative → off-site host
  if (dest.startsWith('/')) return true;
  try {
    const u = new URL(dest);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.length > 0;
  } catch {
    return false;
  }
}

const positional = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--') || ['--prod', '--apply'].includes(args[i - 1])));
const [command, slugArg] = positional;
const slug = slugArg?.toLowerCase();

function requireApplyForProdWrite(description: string): void {
  if (PROD && !APPLY) {
    console.log(`DRY RUN (production): would ${description}`);
    console.log('Re-run with --apply to write.');
    process.exit(0);
  }
}

async function main() {
  const sql = neon(connectionString());
  console.log(`→ ${PROD ? 'PRODUCTION' : 'branch'} database\n`);

  switch (command) {
    case 'list': {
      const rows = await sql`
        SELECT slug, destination, campaign, variant, channel, scan_count, last_scanned_at, notes
        FROM short_links ORDER BY campaign, slug`;
      if (rows.length === 0) {
        console.log('No short links yet. Add one with:  npm run links -- add <slug> --dest <url> --campaign <name>');
        return;
      }
      for (const r of rows) {
        console.log(
          `${String(r.slug).padEnd(20)} → ${r.destination}\n` +
          `${''.padEnd(20)}   campaign=${r.campaign} variant=${r.variant ?? '-'} channel=${r.channel ?? '-'} ` +
          `scans=${r.scan_count} last=${r.last_scanned_at ? new Date(r.last_scanned_at).toISOString() : 'never'}` +
          (r.notes ? `\n${''.padEnd(20)}   ${r.notes}` : ''),
        );
      }
      console.log(`\n${rows.length} link(s).`);
      return;
    }

    case 'add': {
      const dest = flag('dest');
      const campaign = flag('campaign');
      if (!slug || !dest || !campaign) {
        console.error('Usage: npm run links -- add <slug> --dest <url-or-path> --campaign <name> [--variant v] [--channel c] [--notes "..."]');
        process.exit(1);
      }
      if (!SLUG_RE.test(slug)) {
        console.error(`Invalid slug "${slug}" — lowercase letters, digits, hyphens only (max 64), e.g. emu-boards-s.`);
        process.exit(1);
      }
      if (!validDestination(dest)) {
        console.error(`Invalid destination "${dest}" — use a site path like /setup or a full https:// URL.`);
        process.exit(1);
      }
      requireApplyForProdWrite(`add ${slug} → ${dest} (campaign ${campaign})`);
      try {
        await sql`
          INSERT INTO short_links (slug, destination, campaign, variant, channel, notes)
          VALUES (${slug}, ${dest}, ${campaign}, ${flag('variant') ?? null}, ${flag('channel') ?? null}, ${flag('notes') ?? null})`;
      } catch (e: unknown) {
        if (typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505') {
          console.error(`Slug "${slug}" already exists — use \`retarget\` to change its destination (keeps the scan counter). remove+add would destroy its history.`);
          process.exit(1);
        }
        throw e;
      }
      console.log(`Added ${slug} → ${dest}`);
      console.log(`QR target: https://fgac.ai/go/${slug}`);
      return;
    }

    case 'retarget': {
      const dest = flag('dest');
      if (!slug || !dest) {
        console.error('Usage: npm run links -- retarget <slug> --dest <url-or-path>');
        process.exit(1);
      }
      if (!validDestination(dest)) {
        console.error(`Invalid destination "${dest}" — use a site path like /setup or a full https:// URL.`);
        process.exit(1);
      }
      requireApplyForProdWrite(`retarget ${slug} → ${dest}`);
      const rows = await sql`UPDATE short_links SET destination = ${dest} WHERE slug = ${slug} RETURNING slug`;
      console.log(rows.length ? `Retargeted ${slug} → ${dest}` : `No such slug: ${slug}`);
      return;
    }

    case 'remove': {
      if (!slug) {
        console.error('Usage: npm run links -- remove <slug>');
        process.exit(1);
      }
      requireApplyForProdWrite(`remove ${slug} (deletes its scan counter)`);
      const rows = await sql`DELETE FROM short_links WHERE slug = ${slug} RETURNING slug, scan_count`;
      console.log(rows.length ? `Removed ${slug} (had ${rows[0].scan_count} scans)` : `No such slug: ${slug}`);
      return;
    }

    default:
      console.error('Commands: list | add | retarget | remove   (see header of scripts/short-links.ts)');
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
