/* eslint-disable */
import { config } from 'dotenv'
import { execSync } from 'child_process'
import {
  classifyNeonBranch,
  sanitize,
  AGE_THRESHOLD_HOURS,
  IDLE_THRESHOLD_HOURS,
  type NeonBranchLike,
  type NeonEndpointLike,
  type Verdict,
  type MergedRefs,
} from './lib/neon-branch-classifier'

// Load environment variables from .env.local
config({ path: '.env.local' })

/**
 * Prune stale Neon database branches — safe enough to run AUTOMATICALLY
 * (scripts/branch-db.ts invokes it when branch creation hits Neon's branch
 * limit; the daily neon-branch-prune task runs it; it can be run by hand any
 * time).
 *
 * Delete a branch whose compute has been idle more than 6h, once EITHER it is
 * older than 24h OR the PR for its git branch is merged. The primary branch,
 * anything marked `protected` in Neon, and any branch whose compute is running
 * right now are never touched. Git state can only bring deletion forward, never
 * hold it off — when the PR lookup fails the 24h clock still applies. See
 * scripts/lib/neon-branch-classifier.ts for the reasoning and
 * scripts/test-neon-branch-cleanup.ts for the unit tests.
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
 * Latest PR per head ref: `claude/foo` -> { label: '#128', merged: true }.
 *
 * This feeds a DELETE decision (a merged PR drops the 24h requirement), so its
 * failure mode is deliberate: on any error the map is empty, the merged path
 * goes dormant, and every branch falls back to the 24h clock. Git can only make
 * the pruner more prompt, never keep a branch alive — that direction is the bug
 * this whole rewrite removed.
 *
 * Only the NEWEST PR for a ref counts. A reused branch name whose latest PR is
 * open is live work, whatever older merged PRs share the name.
 */
function prStates(): Map<string, { label: string; merged: boolean }> {
  const out = new Map<string, { label: string; merged: boolean }>();
  try {
    const prs = JSON.parse(
      execSync('gh pr list --state all --limit 200 --json number,headRefName,state', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    ) as { number: number; headRefName: string; state: string }[];
    // gh lists newest first, so the first entry for a ref is its current PR.
    for (const pr of prs) {
      if (out.has(pr.headRefName)) continue;
      out.set(pr.headRefName, { label: `#${pr.number}`, merged: pr.state === 'MERGED' });
    }
  } catch {
    console.log('ℹ️  gh unavailable — merged-PR pruning is off this run; the 24h clock still applies.');
  }
  return out;
}

/** Just the merged refs, as the classifier wants them. */
function mergedRefs(prs: ReturnType<typeof prStates>): MergedRefs {
  const out: MergedRefs = new Map();
  for (const [ref, { label, merged }] of prs) if (merged) out.set(ref, label);
  return out;
}

/** `preview/<git-branch>` and `<sanitized-git-branch>` both trace back to a ref. */
function annotate(branchName: string, prs: ReturnType<typeof prStates>): string {
  if (prs.size === 0) return '';
  const previewRef = branchName.startsWith('preview/') ? branchName.slice('preview/'.length) : null;
  const hit = previewRef !== null
    ? prs.get(previewRef)
    : [...prs].find(([ref]) => sanitize(ref) === branchName)?.[1];
  return hit ? `${hit.label} ${hit.merged ? 'merged' : 'open'}` : '';
}

const pad = (v: string, w: number) => v.length >= w ? v : v + ' '.repeat(w - v.length);
const hours = (h: number | null) => (h === null ? '—' : h < 48 ? `${h.toFixed(1)}h` : `${Math.round(h / 24)}d`);

/** The kept-branch table — the part of the daily report Ken actually reads. */
function printKeptTable(kept: { branch: NeonBranchLike; verdict: Verdict }[], prs: ReturnType<typeof prStates>) {
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
  console.log(`   Policy: delete when idle more than ${IDLE_THRESHOLD_HOURS}h AND either older than ${AGE_THRESHOLD_HOURS}h or its PR is merged.`);

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

  // Read once, used twice: as a delete input (merged PRs) and as display-only
  // annotation in the kept table.
  const prs = prStates();
  const merged = mergedRefs(prs);
  if (merged.size > 0) {
    console.log(`🔎 ${merged.size} merged PR head ref(s) — their branches skip the ${AGE_THRESHOLD_HOURS}h wait.`);
  }

  const now = new Date();
  const kept: { branch: NeonBranchLike; verdict: Verdict }[] = [];
  let deletedCount = 0;

  for (const branch of branches) {
    const verdict = classifyNeonBranch(branch, endpointsByBranch.get(branch.id ?? '') ?? [], now, merged);

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

  printKeptTable(kept, prs);
  const billable = Math.max(0, branches.length - deletedCount - 10);
  console.log(`\n💰 ${branches.length - deletedCount} branch(es) remain (including main) — ${billable} billable ≈ $${(billable * 1.5).toFixed(2)}/month.`);
}

main().catch(console.error);
