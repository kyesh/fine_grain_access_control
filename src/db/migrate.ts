import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

const connectionString = process.env.neon__POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL || '';

if (!connectionString) {
  console.log('⚠️  No database connection string found. Skipping migration.');
  process.exit(0);
}

async function main() {
  console.log('🚀 Running database migrations...');

  const sql = neon(connectionString);
  const db = drizzle({ client: sql });

  // Bootstrap: if this database was previously managed with `drizzle-kit push`,
  // the application tables exist but Drizzle's migration tracking table does not.
  // We need to seed migration 0000 into Drizzle's tracking table (in the "drizzle" schema)
  // so the migrator skips it and only runs new migrations.
  
  // Create the drizzle schema and tracking table (matching what the migrator creates)
  await sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`;
  await sql`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;

  // Check if the initial migration is already tracked
  const existing = await sql`
    SELECT id FROM "drizzle"."__drizzle_migrations" LIMIT 1
  `;

  if (existing.length === 0) {
    // Check if the tables from migration 0000 actually exist (from drizzle-kit push)
    const tablesExist = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'
      ) as "exists"
    `;

    if (tablesExist[0]?.exists) {
      console.log('📋 Database was managed with drizzle-kit push. Seeding migration 0000 as already applied...');
      // The folderMillis from _journal.json for migration 0000 is 1773271056274
      // We use the same value so the migrator's comparison (created_at < folderMillis) works correctly
      await sql`
        INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
        VALUES ('0000_redundant_night_nurse', ${1773271056274})
      `;
    }
  }

  await migrate(db, { migrationsFolder: './src/db/migrations' });

  console.log('✅ Migrations complete!');
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
