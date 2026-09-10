/* eslint-disable */
import { config } from 'dotenv'
import { execSync } from 'child_process'
import {
  classifyNeonBranch,
  AGE_THRESHOLD_HOURS,
  IDLE_THRESHOLD_HOURS,
  type NeonBranchLike,
  type NeonEndpointLike,
} from './lib/neon-branch-classifier'

// Load environment variables from .env.local
config({ path: '.env.local' })

/**
 * Prune stale Neon database branches — safe enough to run AUTOMATICALLY
 * (scripts/branch-db.ts invokes it when branch creation hits Neon's branch
 * limit; the daily neon-branch-prune task runs it; it can be run by hand any
 * time).
 *
 * The rule is time, not git provenance: delete a branch older than 24h whose
 * compute has been idle more than 6h. The primary branch, anything marked
 * `protected` in Neon, and any branch whose compute is running right now are
 * never touched. See scripts/lib/neon-branch-classifier.ts for the reasoning
 * and scripts/test-neon-branch-cleanup.ts for the unit tests.
 *
 * A deleted branch is recoverable in the sense that matters: `npm run db:branch`
 * recreates one from main. It is NOT recoverable in the sense of accumulated
 * QA state (approved connections, proxy keys, rules) — that is gone, and a
 * worktree whose .env.local still points at the deleted branch must re-run
 * db:branch before its dev server will connect.
 *
 * `--dry-run` prints what would be deleted without deleting.
 */

const DRY_RUN = process.argv.includes('--dry-run');

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
  console.log(`🧹 Scanning for stale Neon database branches...${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`   Policy: delete when older than ${AGE_THRESHOLD_HOURS}h AND idle more than ${IDLE_THRESHOLD_HOURS}h.`);

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

  const branches: NeonBranchLike[] = runNeonCmd(`branches list --project-id ${projectId}`);

  // Compute endpoints carry `last_active` — the only trustworthy idleness
  // signal (see the classifier's note on why branch.updated_at is not).
  // This neonctl build has no `endpoints` subcommand; go through the raw API.
  // Without it every branch would look permanently idle, which would delete
  // branches a running dev server is using — so a failure here aborts.
  let endpointsByBranch = new Map<string, NeonEndpointLike[]>();
  try {
    const payload = runNeonCmd(`api "/projects/${projectId}/endpoints"`);
    const endpoints: NeonEndpointLike[] = payload.endpoints ?? payload;
    if (!Array.isArray(endpoints)) throw new Error('unexpected endpoints payload');
    for (const e of endpoints) {
      if (!e.branch_id) continue;
      const list = endpointsByBranch.get(e.branch_id) ?? [];
      list.push(e);
      endpointsByBranch.set(e.branch_id, list);
    }
  } catch (error: any) {
    console.error('❌ Could not read compute endpoints — aborting without deleting anything.');
    console.error(`   ${error?.message ?? error}`);
    process.exit(1);
  }

  const now = new Date();
  let deletedCount = 0;
  let keptCount = 0;

  for (const branch of branches) {
    const verdict = classifyNeonBranch(branch, endpointsByBranch.get(branch.id ?? '') ?? [], now);

    if (verdict.action === 'skip') continue;

    if (verdict.action === 'keep') {
      console.log(`⏭️  Keeping ${branch.name} (${verdict.reason})`);
      keptCount++;
      continue;
    }

    console.log(`🗑️  ${DRY_RUN ? 'Would delete' : 'Deleting'} stale Neon branch: ${branch.name} (${branch.id}) — ${verdict.reason}`);
    if (!DRY_RUN) {
      runNeonCmd(`branches delete ${branch.id} --project-id ${projectId}`);
    }
    deletedCount++;
  }

  if (deletedCount === 0) {
    console.log(`✨ No stale branches found to clean up (${keptCount} still in the window).`);
  } else {
    console.log(`✅ ${DRY_RUN ? 'Would clean up' : 'Successfully cleaned up'} ${deletedCount} stale branch(es); ${keptCount} kept.`);
  }
}

main().catch(console.error);
