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

async function getGitBranch() {
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
    const created = runNeonCmd(`branches create --project-id ${projectId} --name ${branchName} --compute`);
    if (created && created.connection_uris && created.connection_uris.length > 0) {
      const uri = created.connection_uris[0].connection_uri;
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
