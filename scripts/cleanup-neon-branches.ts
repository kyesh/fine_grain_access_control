/* eslint-disable */
import { config } from 'dotenv'
import { execSync } from 'child_process'
import {
  classifyNeonBranch,
  AGE_THRESHOLD_HOURS,
  IDLE_THRESHOLD_HOURS,
  type NeonBranchLike,
  type NeonEndpointLike,
  type Verdict,
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

/**
 * Head-ref -> "#<n> merged|open" for annotating the kept-branch table.
 * DISPLAY ONLY — nothing here reaches classifyNeonBranch, which is deliberately
 * blind to git and PR state. Best-effort: without `gh` the column is simply
 * blank, and the prune is unaffected.
 */
function prAnnotations(): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const prs = JSON.parse(
      execSync('gh pr list --state all --limit 100 --json number,headRefName,state', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    ) as { number: number; headRefName: string; state: string }[];
    for (const pr of prs) {
      // Newest first, so the first entry for a ref is the current PR for it.
      if (!out.has(pr.headRefName)) out.set(pr.headRefName, `#${pr.number} ${pr.state.toLowerCase()}`);
    }
  } catch { /* no gh — the column stays blank */ }
  return out;
}

/** `preview/<git-branch>` and `<sanitized-git-branch>` both trace back to a ref. */
function annotate(branchName: string, prs: Map<string, string>): string {
  if (prs.size === 0) return '';
  const previewRef = branchName.startsWith('preview/') ? branchName.slice('preview/'.length) : null;
  if (previewRef && prs.has(previewRef)) return prs.get(previewRef)!;
  const sanitized = (n: string) => n.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  for (const [ref, label] of prs) if (sanitized(ref) === branchName) return label;
  return '';
}

const pad = (v: string, w: number) => v.length >= w ? v : v + ' '.repeat(w - v.length);
const hours = (h: number | null) => (h === null ? '—' : h < 48 ? `${h.toFixed(1)}h` : `${Math.round(h / 24)}d`);

/** The kept-branch table — the part of the daily report Ken actually reads. */
function printKeptTable(kept: { branch: NeonBranchLike; verdict: Verdict }[], prs: Map<string, string>) {
  if (kept.length === 0) return;
  console.log(`\n📋 Kept ${kept.length} branch(es) — nothing here is billable until the project exceeds 10:\n`);

  const rows = kept.map(({ branch, verdict }) => ({
    name: branch.name,
    age: hours(verdict.metrics.ageHours),
    idle: hours(verdict.metrics.idleHours),
    why: verdict.reason,
    next: verdict.metrics.eligibleInHours === null
      ? 'not on a timer'
      : `in ~${hours(Math.max(0, verdict.metrics.eligibleInHours))}`,
    pr: annotate(branch.name, prs),
  }));

  const cols = [
    { h: 'BRANCH', get: (r: typeof rows[0]) => r.name },
    { h: 'AGE', get: (r: typeof rows[0]) => r.age },
    { h: 'IDLE', get: (r: typeof rows[0]) => r.idle },
    { h: 'KEPT BECAUSE', get: (r: typeof rows[0]) => r.why },
    { h: 'PRUNES', get: (r: typeof rows[0]) => r.next },
    { h: 'PR', get: (r: typeof rows[0]) => r.pr },
  ];
  const widths = cols.map(c => Math.max(c.h.length, ...rows.map(r => c.get(r).length)));

  console.log('   ' + cols.map((c, i) => pad(c.h, widths[i])).join('  ').trimEnd());
  console.log('   ' + widths.map(w => '-'.repeat(w)).join('  '));
  for (const r of rows) {
    console.log('   ' + cols.map((c, i) => pad(c.get(r), widths[i])).join('  ').trimEnd());
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
  const kept: { branch: NeonBranchLike; verdict: Verdict }[] = [];
  let deletedCount = 0;

  for (const branch of branches) {
    const verdict = classifyNeonBranch(branch, endpointsByBranch.get(branch.id ?? '') ?? [], now);

    if (verdict.action === 'skip') continue;

    if (verdict.action === 'keep') {
      console.log(`⏭️  Keeping ${branch.name} (${verdict.reason})`);
      kept.push({ branch, verdict });
      continue;
    }

    console.log(`🗑️  ${DRY_RUN ? 'Would delete' : 'Deleting'} stale Neon branch: ${branch.name} (${branch.id}) — ${verdict.reason}`);
    if (!DRY_RUN) {
      runNeonCmd(`branches delete ${branch.id} --project-id ${projectId}`);
    }
    deletedCount++;
  }

  if (deletedCount === 0) {
    console.log(`✨ No stale branches found to clean up (${kept.length} still in the window).`);
  } else {
    console.log(`✅ ${DRY_RUN ? 'Would clean up' : 'Successfully cleaned up'} ${deletedCount} stale branch(es); ${kept.length} kept.`);
  }

  printKeptTable(kept, prAnnotations());
  const billable = Math.max(0, branches.length - deletedCount - 10);
  console.log(`\n💰 ${branches.length - deletedCount} branch(es) remain (including main) — ${billable} billable ≈ $${(billable * 1.5).toFixed(2)}/month.`);
}

main().catch(console.error);
