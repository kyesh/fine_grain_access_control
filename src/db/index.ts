import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import { resolveConnection } from './connectionSafety';

// ─── Connection Safety ──────────────────────────────────────────────────────
// Outside a production runtime the ONLY acceptable connection is the isolated
// Neon branch written by `npm run db:branch` (neon__POSTGRES_URL), and it is
// rejected if it resolves to the production host.
//
// There is deliberately no fallback chain in development. The old guard fell
// back to POSTGRES_URL / DATABASE_URL when the branch URL was missing, and both
// of those point at production in a pulled .env.local — so losing the branch
// URL silently connected local code to prod without printing anything.
//
// Run `npm run env:check` to see what the current environment resolves to.
// ─────────────────────────────────────────────────────────────────────────────

const resolution = resolveConnection({
  isProductionRuntime: process.env.NODE_ENV === 'production',
  isBuildTime: process.env.NEXT_PHASE === 'phase-production-build',
  env: process.env,
});

if (resolution.fatal) {
  console.error(`\n🚨 DATABASE SAFETY\n\n${resolution.fatal}\n`);
}

// Dummy connection keeps build-time static analysis working; real queries fail.
const sql = neon(resolution.connectionString || 'postgres://dummy:dummy@localhost:5432/dummy');
export const db = drizzle({ client: sql, schema });
