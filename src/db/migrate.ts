import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

const connectionString = process.env.neon__POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL || '';

if (!connectionString) {
  console.log('⚠️  No database connection string found. Skipping migration.');
  process.exit(0); // Don't fail the build if no DB URL — just skip
}

async function main() {
  console.log('🚀 Running database migrations...');

  const sql = neon(connectionString);
  const db = drizzle({ client: sql });

  // Ensure the Drizzle migrations tracking table exists.
  // If this is a database that was previously managed with `drizzle-kit push`,
  // the application tables exist but the tracking table does not.
  // We seed migration 0000 as "already applied" so the migrator skips it.
  await sql(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  // Check if the first migration is already tracked
  const existing = await sql(`SELECT id FROM "__drizzle_migrations" WHERE hash = '0000_redundant_night_nurse' LIMIT 1`);

  if (existing.length === 0) {
    // Check if the tables from migration 0000 actually exist
    const tablesExist = await sql(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'
      ) as exists
    `);

    if (tablesExist[0]?.exists) {
      console.log('📋 Seeding migration 0000 as already applied (tables exist from drizzle-kit push)...');
      await sql(`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ('0000_redundant_night_nurse', ${Date.now()})`);
    }
  }

  await migrate(db, { migrationsFolder: './src/db/migrations' });

  console.log('✅ Migrations complete!');
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
