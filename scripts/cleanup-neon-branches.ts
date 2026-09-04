/* eslint-disable */
import { config } from 'dotenv'
import { execSync } from 'child_process'
import { classifyNeonBranch, type GitState } from './lib/neon-branch-classifier'

// Load environment variables from .env.local
config({ path: '.env.local' })

/**
 * Prune stale Neon database branches — safe enough to run AUTOMATICALLY
 * (scripts/branch-db.ts invokes it when branch creation hits Neon's branch
 * limit; the scheduled cost check runs it; it can be run by hand any time).
 *
 * The rules live in scripts/lib/neon-branch-classifier.ts (pure, unit-tested
 * by scripts/test-neon-branch-cleanup.ts). In order of precedence:
 *
 *   1. The primary/default branch, and a branch named exactly `main`, are
 *      never touched. Exact match only — a substring test once hid every
 *      branch whose name merely CONTAINED "main" (ger·main, do·main…) from
 *      the run output entirely.
 *   2. A Neon branch whose git branch is checked out in ANY git worktree
 *      (`git worktree list`) is kept, in both the `preview/<git-branch>` and
 *      the sanitized local-dev form — even if that branch is already merged.
 *      A session running a dev server must never lose its database mid-run.
 *   3. `preview/<git-branch>` (Vercel preview integration) is stale when the
 *      git branch is gone from origin or merged into origin/main. One backing
 *      an OPEN PR is never touched — deleting it breaks that PR's live
 *      preview deployment.
 *   4. `<sanitized-git-branch>` (local dev via db:branch) is stale when its
 *      origin ref is merged, OR — since GitHub deletes the head branch on
 *      merge, so "gone from origin" is the normal end-of-life state — when the
 *      origin ref is gone and either a leftover LOCAL branch is an ancestor of
 *      origin/main or a merged/closed PR's head ref matches. An unmerged local
 *      branch is kept (it may be an active unpushed session).
 *   5. Anything that maps to no git branch anywhere is kept (unknown ≠ stale).
 *
 * A failed `git fetch` / `ls-remote` aborts BEFORE any deletion.
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

  const branches = runNeonCmd(`branches list --project-id ${projectId}`);

  // Remote git branches (raw names). origin/main must be current for the
  // merge checks below, so this fetch is not optional.
  let remoteBranches: string[];
  try {
    execSync('git fetch origin --quiet', { encoding: 'utf-8' });
    remoteBranches = execSync('git ls-remote --heads origin', { encoding: 'utf-8' })
      .split('\n')
      .map(line => line.split('refs/heads/')[1]?.trim())
      .filter((b): b is string => !!b);
  } catch (error) {
    // No remote view = no way to prove staleness. Refuse to guess.
    console.error('❌ Could not fetch remote git branches — aborting without deleting anything.');
    process.exit(1);
  }

  const isMergedIntoMain = (ref: string): boolean => {
    try {
      execSync(`git merge-base --is-ancestor "${ref}" origin/main`, { encoding: 'utf-8' });
      return true;
    } catch {
      return false;
    }
  };

  // Local branches (includes branches owned by other worktrees) — an unpushed
  // or merge-deleted branch has no remote ref but may still prove state.
  let localBranches: string[] = [];
  try {
    localBranches = execSync("git for-each-ref --format='%(refname:short)' refs/heads", { encoding: 'utf-8' })
      .split('\n')
      .map(b => b.replace(/^'|'$/g, '').trim())
      .filter(Boolean);
  } catch { /* no local view — the unknown-branch rule keeps them */ }

  // Head refs of finished (merged or closed) PRs, so a db:branch Neon branch
  // whose git branch was deleted everywhere can still be proven stale.
  // Best-effort: without gh, unknown names are simply kept.
  const finishedPrHeadRefs = new Map<string, 'merged' | 'closed'>();
  try {
    for (const state of ['merged', 'closed'] as const) {
      JSON.parse(
        execSync(`gh pr list --state ${state} --limit 300 --json headRefName`, { encoding: 'utf-8' })
      ).forEach((pr: { headRefName: string }) => {
        if (!finishedPrHeadRefs.has(pr.headRefName)) finishedPrHeadRefs.set(pr.headRefName, state);
      });
    }
  } catch {
    console.log('ℹ️  gh unavailable — skipping finished-PR matching (unknown branches will be kept).');
  }

  let currentBranch: string | null = null;
  try {
    const head = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    if (head && head !== 'HEAD') currentBranch = head;
  } catch { /* detached HEAD etc. — worktree protection below still applies */ }

  // Branches checked out in ANY worktree. Their Neon branches are kept even
  // when merged — a live session's database must never vanish mid-run.
  const checkedOutBranches: string[] = [];
  try {
    execSync('git worktree list --porcelain', { encoding: 'utf-8' })
      .split('\n')
      .filter(l => l.startsWith('branch refs/heads/'))
      .forEach(l => checkedOutBranches.push(l.slice('branch refs/heads/'.length).trim()));
  } catch { /* worktrees unavailable — current-branch protection still applies */ }
  if (checkedOutBranches.length > 0) {
    console.log(`🔒 Protecting ${checkedOutBranches.length} branch(es) checked out in git worktrees`);
  }

  const git: GitState = {
    remoteBranches,
    localBranches,
    checkedOutBranches,
    currentBranch,
    finishedPrHeadRefs,
    isMergedIntoMain,
  };

  let deletedCount = 0;
  for (const branch of branches) {
    const verdict = classifyNeonBranch(branch, git);

    if (verdict.action === 'skip') continue;

    if (verdict.action === 'keep') {
      console.log(`⏭️  Keeping ${branch.name} (${verdict.reason})`);
      continue;
    }

    console.log(`🗑️  ${DRY_RUN ? 'Would delete' : 'Deleting'} stale Neon branch: ${branch.name} (${branch.id}) — ${verdict.reason}`);
    if (!DRY_RUN) {
      runNeonCmd(`branches delete ${branch.id} --project-id ${projectId}`);
    }
    deletedCount++;
  }

  if (deletedCount === 0) {
    console.log('✨ No stale branches found to clean up.');
  } else {
    console.log(`✅ ${DRY_RUN ? 'Would clean up' : 'Successfully cleaned up'} ${deletedCount} stale branch(es).`);
  }
}

main().catch(console.error);
