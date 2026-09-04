/* eslint-disable */
import { config } from 'dotenv'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

// Load environment variables from .env.local
config({ path: '.env.local' })

function runNeonCmd(cmd: string) {
  try {
    return JSON.parse(execSync(`npx --yes neonctl ${cmd} -o json`, { encoding: 'utf-8' }));
  } catch (error: any) {
    console.error(`❌ Neon CLI error. Are you authenticated?`);
    process.exit(1);
  }
}

/** Like runNeonCmd, but returns the failure instead of exiting — for callers
 * that can recover (e.g. branch-limit → cleanup → retry). */
function tryNeonCmd(cmd: string): { result?: any; error?: string } {
  try {
    return { result: JSON.parse(execSync(`npx --yes neonctl ${cmd} -o json`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })) };
  } catch (error: any) {
    const stderr = error?.stderr?.toString?.() ?? '';
    return { error: (stderr || error?.message || 'unknown neonctl error').trim() };
  }
}

async function getGitBranch() {
  if (process.env.VERCEL_GIT_COMMIT_REF) {
    return process.env.VERCEL_GIT_COMMIT_REF;
  }
  try {
    return execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
  } catch {
    console.error('❌ Error: Not a git repository or git is not installed.')
    process.exit(1)
  }
}

async function updateEnvLocal(connectionString: string) {
  const envPath = path.join(process.cwd(), '.env.local')
  let envContent = ''

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8')
  }

  // Regex to remove old URL mappings
  envContent = envContent.replace(/^DATABASE_URL=.*$/gm, '')
  envContent = envContent.replace(/^neon__POSTGRES_URL=.*$/gm, '')
  envContent = envContent.replace(/^DB_PROVIDER=.*$/gm, '')
  envContent = envContent.replace(/^POSTGRES_PRISMA_URL=.*$/gm, '')
  envContent = envContent.replace(/^POSTGRES_URL_NON_POOLING=.*$/gm, '')
  envContent = envContent.replace(/^POSTGRES_URL_NO_SSL=.*$/gm, '')
  envContent = envContent.replace(/^POSTGRES_URL=.*$/gm, '')

  const newEntry = `neon__POSTGRES_URL="${connectionString}"\nDB_PROVIDER="neon"`
  envContent += `\n${newEntry}\n`

  fs.writeFileSync(envPath, envContent.replace(/\n\n+/g, '\n'))
  console.log('✅ Updated .env.local with new neon__POSTGRES_URL')
}

async function main() {
  if (process.env.VERCEL || process.env.CI) {
    console.log('☁️  Vercel CI environment detected. Skipping interactive database branching.');
    return;
  }

  const gitBranch = await getGitBranch()
  const branchName = gitBranch.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()

  if (branchName === 'main') {
    const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout })
    console.error('\n🚨 FATAL: You are attempting to run an operation against the PRODUCTION database!')
    console.error('Did you forget to run `npm run db:branch` first?\n')

    await new Promise<void>((resolve) => {
      readline.question(`Type 'prod please' to modify production, or anything else to safely abort.\n> `, (answer: string) => {
        readline.close()
        if (answer.trim() === 'prod please') {
          console.warn('\n⚠️  Proceeding to fetch PRODUCTION database credentials...')
          resolve()
        } else {
          console.error('\n🛑 Aborted.')
          process.exit(1)
        }
      })
    })
  }

  console.log(`🚀 Preparing Neon database branch for: ${branchName}`)

  let projectId = process.env.NEON_PROJECT_ID
  if (!projectId) {
    const projects = runNeonCmd('projects list');
    if (projects.length === 0) {
      console.error('❌ No Neon projects found.');
      process.exit(1);
    }
    projectId = projects[0].id;
  }

  console.log(`Using project ID: ${projectId}`);

  const branches = runNeonCmd(`branches list --project-id ${projectId}`);
  let branch = branches.find((b: any) => b.name === branchName);

  if (!branch) {
    console.log(`🌿 Branch '${branchName}' not found. Creating from 'main'...`);
    // Neon caps the project at 10 branches; stale branches of merged work
    // accumulate until creation fails. Self-heal: on a limit error, prune
    // stale branches (scripts/cleanup-neon-branches.ts — safe rules: never the
    // primary, never a branch checked out in any worktree, never an open PR's
    // preview, only provably-merged work) and retry once.
    let created = tryNeonCmd(`branches create --project-id ${projectId} --name ${branchName} --compute`);
    if (created.error) {
      if (!/limit/i.test(created.error)) {
        console.error(`❌ Neon CLI error: ${created.error}`);
        process.exit(1);
      }
      console.log('⚠️ Neon branch limit reached — running stale-branch cleanup and retrying...');
      execSync('npx tsx scripts/cleanup-neon-branches.ts', { stdio: 'inherit' });
      created = tryNeonCmd(`branches create --project-id ${projectId} --name ${branchName} --compute`);
      if (created.error) {
        console.error(`❌ Branch creation still failing after cleanup: ${created.error}`);
        console.error('   Every remaining Neon branch maps to active work — free one manually.');
        process.exit(1);
      }
    }
    const createdBranch = created.result;
    if (createdBranch && createdBranch.connection_uris && createdBranch.connection_uris.length > 0) {
      const uri = createdBranch.connection_uris[0].connection_uri;
      console.log(`✅ Created branch '${branchName}'!`);
      await updateEnvLocal(uri);
      console.log(`🎉 Ready! Local environment connected to branch: ${branchName}`);
    } else {
        console.error("❌ Failed to parse connection URI from generated branch.");
        process.exit(1);
    }
  } else {
    console.log(`🌿 Branch '${branchName}' already exists.`);
    console.log(`⚠️ Because the branch already exists, we cannot insecurely extract its password via standard CLI.`);
    console.log(`   If your .env.local isn't synced, manually retrieve the connection string from the Neon dash.`);
  }
}

main()
