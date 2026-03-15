import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

// Vercel's Neon integration populates neon__POSTGRES_URL (or POSTGRES_URL) for branch databases in Preview environments,
// defaulting to DATABASE_URL for Production. This ensures Dev changes do not affect Prod.
const connectionString = process.env.neon__POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL || '';

if (!connectionString) {
  console.warn('DATABASE_URL (or neon__POSTGRES_URL) is not set; database operations will fail.');
}

// Fallback to a dummy connection for build time static analysis if no string is provided.
const sql = neon(connectionString || 'postgres://dummy:dummy@localhost:5432/dummy');
export const db = drizzle({ client: sql });
