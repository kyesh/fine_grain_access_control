import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

// Vercel's Neon integration populates neon__POSTGRES_URL for branch databases in Preview environments,
// defaulting to DATABASE_URL for Production. This ensures Dev changes do not affect Prod.
const connectionString = process.env.neon__POSTGRES_URL || process.env.DATABASE_URL || '';

if (!connectionString) {
  console.warn('DATABASE_URL (or neon__POSTGRES_URL) is not set; database operations will fail.');
}

const sql = neon(connectionString);
export const db = drizzle({ client: sql });
