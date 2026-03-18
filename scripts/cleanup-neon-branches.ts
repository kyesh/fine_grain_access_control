/* eslint-disable */
import { config } from 'dotenv'
import { execSync } from 'child_process'

// Load environment variables from .env.local
config({ path: '.env.local' })

function runNeonCmd(cmd: string) {
  try {
    const output = execSync(`npx --yes neonctl ${cmd} -o json`, { encoding: 'utf-8' });
    return JSON.parse(output);
  } catch (error: any) {
    console.error(`❌ Neon CLI error executing: ${cmd}`);
    console.error(error.message);
    process.exit(1);
  }
}

async function main() {
  console.log('🧹 Scanning for stale Neon database branches...');

  let projectId = process.env.NEON_PROJECT_ID;
  if (!projectId) {
    const projects = runNeonCmd('projects list');
    if (projects.length === 0) {
      console.error('❌ No Neon projects found.');
      process.exit(1);
    }
    projectId = projects[0].id;
  }

  console.log(`Using project ID: ${projectId}`);

  // Get all branches
  const branches = runNeonCmd(`branches list --project-id ${projectId}`);
  
  // Also get git branches from remote to know what is actually stale
  let remoteGitBranches: string[] = [];
  try {
    const gitOutput = execSync('git ls-remote --heads origin', { encoding: 'utf-8' });
    remoteGitBranches = gitOutput.split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => {
        const parts = line.split('refs/heads/');
        if (parts.length > 1) {
           // match the sanitization logic used in branch-db.ts
           return parts[1].trim().replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
        }
        return '';
      }).filter(b => b !== '');
  } catch (error) {
    console.error('⚠️ Could not fetch remote git branches. Proceeding with caution.');
  }

  let deletedCount = 0;
  for (const branch of branches) {
    // Never delete the primary/main branch
    if (branch.primary || branch.name === 'main' || branch.name.includes('main')) {
      continue;
    }

    // Check if branch name corresponds to an active git branch
    const isActive = remoteGitBranches.includes(branch.name);
    
    // Check age (e.g. older than 7 days if we wanted, but for now just if it has no active PR/Git branch)
    // Note: If you don't have remoteGitBranches, we might not want to delete.
    if (remoteGitBranches.length > 0 && !isActive) {
      console.log(`🗑️  Deleting stale Neon branch: ${branch.name} (${branch.id})`);
      runNeonCmd(`branches delete ${branch.id} --project-id ${projectId}`);
      deletedCount++;
    } else if (remoteGitBranches.length === 0) {
        console.log(`⏭️  Skipping ${branch.name} because remote git branches could not be fetched.`);
    }
  }

  if (deletedCount === 0) {
    console.log('✨ No stale branches found to clean up.');
  } else {
    console.log(`✅ Successfully cleaned up ${deletedCount} stale branches.`);
  }
}

main().catch(console.error);
