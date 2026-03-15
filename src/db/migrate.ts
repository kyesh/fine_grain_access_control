import { neon } from '@neondatabase/serverless';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { execSync } from 'child_process';

const getGitBranch = () => {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
};

const gitBranch = getGitBranch();
const isMainBranch = gitBranch === 'main';

const connectionString = process.env.neon__POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '';

if (!isMainBranch && connectionString.includes('.neon.tech')) {
  if (!process.env.neon__POSTGRES_URL) {
    console.log(`\n🌿 Branch '${gitBranch}' isolated connection missing. Auto-provisioning via neonctl...`);
    try {
      execSync('npm run db:branch', { stdio: 'inherit' });
      // Refresh process.env
      require('dotenv').config({ path: '.env.local', override: true });
      if (!process.env.neon__POSTGRES_URL) {
        throw new Error('neon__POSTGRES_URL remaining missing');
      }
    } catch (e: any) {
      console.error(`\n🚨 MIGRATE SAFETY ABORT: Auto-provisioning failed.`);
      process.exit(1);
    }
  }
}

const finalConnectionString = process.env.neon__POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '';

if (!finalConnectionString) {
  console.log('⚠️  No database connection string found. Skipping migration.');
  process.exit(0);
}

// Migration files in execution order
const MIGRATIONS = [
  '0000_redundant_night_nurse.sql',
  '0001_multi_key_multi_email.sql',
  '0002_email_delegations.sql',
];

/**
 * Split a SQL file into individual statements, handling DO $$ ... $$ blocks.
 * Neon's serverless driver can only execute one statement at a time.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarBlock = false;

  const lines = sql.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments at statement boundaries
    if (!inDollarBlock && !current.trim() && (trimmed === '' || trimmed.startsWith('--'))) {
      continue;
    }

    current += line + '\n';

    // Track DO $$ blocks
    if (trimmed.startsWith('DO $$') || trimmed.startsWith('DO $block$')) {
      inDollarBlock = true;
    }

    if (inDollarBlock && (trimmed.endsWith('$$;') || trimmed.endsWith('$block$;'))) {
      inDollarBlock = false;
      statements.push(current.trim());
      current = '';
      continue;
    }

    // Regular statement ending with ;
    if (!inDollarBlock && trimmed.endsWith(';') && !trimmed.startsWith('--')) {
      statements.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements.filter(s => s && !s.startsWith('--'));
}

async function main() {
  console.log('🚀 Running database migrations...');

  const sql = neon(finalConnectionString);
  const migrationsDir = join(process.cwd(), 'src', 'db', 'migrations');

  for (const file of MIGRATIONS) {
    const filePath = join(migrationsDir, file);
    if (!existsSync(filePath)) {
      console.log(`  ⏭️  ${file} not found, skipping`);
      continue;
    }

    console.log(`  📄 Running ${file}...`);
    const content = readFileSync(filePath, 'utf8');
    const statements = splitStatements(content);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await sql.query(stmt);
      } catch (err: any) {
        // Ignore idempotent errors — these occur when re-running migrations
        const ignorable = [
          'already exists',
          'duplicate_object',
          'undefined_column', // column dropped by later migration
          'undefined_table',  // table dropped by later migration
          '42703',            // PostgreSQL undefined_column
          '42P01',            // PostgreSQL undefined_table
        ];
        const isIgnorable = ignorable.some(s =>
          err.message?.includes(s) || err.code === s
        );
        if (isIgnorable) {
          console.log(`    ↳ Skipped (safe to ignore): ${stmt.substring(0, 60)}...`);
        } else {
          console.error(`    ❌ Failed statement ${i + 1}/${statements.length}:`, stmt.substring(0, 100));
          throw err;
        }
      }
    }

    console.log(`  ✅ ${file} complete (${statements.length} statements)`);
  }

  console.log('✅ All migrations complete!');
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
