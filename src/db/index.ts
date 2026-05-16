import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// ─── Connection Safety ──────────────────────────────────────────────────────
// In development, we MUST use a Neon branch (neon__POSTGRES_URL) to avoid
// accidentally writing to the production database. The branch URL is set by
// `npm run db:branch` in .env.local.
//
// In production (Vercel), Neon populates the correct URL automatically.
//
// DATABASE_URL_UNPOOLED is kept in .env.local for rare cases where we need
// to query production data directly (e.g., debugging), but it must NEVER be
// used as the runtime database connection in development.
// ─────────────────────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV !== 'production';
const isBuildTime = process.env.NEXT_PHASE === 'phase-production-build';

// Primary: branch URL (set by db:branch or Vercel Neon integration)
// Fallback: POSTGRES_URL (Vercel preview deployments)
// Last resort: DATABASE_URL (production only)
const branchUrl = process.env.neon__POSTGRES_URL || process.env.POSTGRES_URL;
const prodUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

let connectionString: string;

if (branchUrl) {
  // Branch URL is available — safe to use
  connectionString = branchUrl;
} else if (isDev && !isBuildTime) {
  // Development mode WITHOUT a branch URL — this is dangerous
  if (prodUrl) {
    console.error(
      '\n' +
      '🚨 DATABASE SAFETY: Refusing to connect to production database in development.\n' +
      '\n' +
      '   You have a production database URL set (DATABASE_URL_UNPOOLED or DATABASE_URL)\n' +
      '   but no branch URL (neon__POSTGRES_URL). This means local writes would hit prod.\n' +
      '\n' +
      '   To fix this, run:\n' +
      '     npm run db:branch\n' +
      '\n' +
      '   This creates an isolated Neon branch for your feature branch.\n' +
      '   Database operations will fail until a branch is provisioned.\n' +
      '\n'
    );
    // Use a dummy URL that will fail on actual queries but won't hit prod
    connectionString = '';
  } else {
    console.warn('DATABASE_URL (or neon__POSTGRES_URL) is not set; database operations will fail.');
    connectionString = '';
  }
} else {
  // Production or build time — use whatever is available
  connectionString = prodUrl || '';
  if (!connectionString && !isBuildTime) {
    console.warn('DATABASE_URL (or neon__POSTGRES_URL) is not set; database operations will fail.');
  }
}

// Fallback to a dummy connection for build time static analysis if no string is provided.
const sql = neon(connectionString || 'postgres://dummy:dummy@localhost:5432/dummy');
export const db = drizzle({ client: sql, schema });
