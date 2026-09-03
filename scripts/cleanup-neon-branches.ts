/* eslint-disable */
import { config } from 'dotenv'
import { execSync } from 'child_process'

// Load environment variables from .env.local
config({ path: '.env.local' })

/**
 * Prune stale Neon database branches — safe enough to run AUTOMATICALLY
 * (scripts/branch-db.ts invokes it when branch creation hits Neon's
 * 10-branch limit, and it can be run by hand any time).
 *
 * A Neon branch is STALE when the git branch it serves is finished:
 *   - `preview/<git-branch>` (Vercel preview integration): the git branch no
 *     longer exists on origin, or is merged into origin/main. A preview
 *     branch backing an OPEN PR is never touched — deleting it breaks that
 *     PR's live preview deployment (the old version of this script did
 *     exactly that: it deleted every preview/* branch unconditionally).
 *   - `<sanitized-git-branch>` (local dev via db:branch): same rule, with
 *     one extra protection — the CURRENT local git branch's Neon branch is
 *     never deleted even if merged, so an active dev server doesn't lose its
 *     database mid-session.
 *   - Anything that maps to no known git branch, current or historical,
 *     is left alone (unknown ≠ stale).
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

const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();

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

  // Remote git branches (raw names) and their merge state vs origin/main.
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

  const refMergedIntoMain = (ref: string): boolean => {
    try {
      execSync(`git merge-base --is-ancestor "${ref}" origin/main`, { encoding: 'utf-8' });
      return true;
    } catch {
      return false;
    }
  };
  const mergedIntoMain = (gitBranch: string): boolean => refMergedIntoMain(`origin/${gitBranch}`);

  const sanitizedToRaw = new Map<string, string>();
  for (const b of remoteBranches) sanitizedToRaw.set(sanitize(b), b);

  // Local branches (includes branches checked out in other worktrees) — an
  // unpushed local branch has no remote ref but its Neon branch may be in use.
  const localSanitizedToRaw = new Map<string, string>();
  try {
    execSync("git for-each-ref --format='%(refname:short)' refs/heads", { encoding: 'utf-8' })
      .split('\n')
      .map(b => b.replace(/^'|'$/g, '').trim())
      .filter(Boolean)
      .forEach(b => localSanitizedToRaw.set(sanitize(b), b));
  } catch { /* no local view — the unknown-branch rule below still keeps them */ }

  // Head refs of finished (merged or closed) PRs, so a db:branch Neon branch
  // whose git branch was deleted after merge can still be proven stale.
  // Best-effort: if gh is unavailable/unauthenticated we just fall back to
  // the old behavior (unknown names are kept, never deleted).
  const finishedPrSanitized = new Set<string>();
  try {
    for (const state of ['merged', 'closed']) {
      JSON.parse(
        execSync(`gh pr list --state ${state} --limit 300 --json headRefName`, { encoding: 'utf-8' })
      ).forEach((pr: { headRefName: string }) => finishedPrSanitized.add(sanitize(pr.headRefName)));
    }
  } catch {
    console.log('ℹ️  gh unavailable — skipping finished-PR matching (unknown branches will be kept).');
  }

  let currentBranchSanitized = '';
  try {
    currentBranchSanitized = sanitize(execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim());
  } catch { /* detached HEAD etc. — no extra protection possible */ }

  // Branches checked out in ANY worktree get the same protection as the
  // current branch — a live session's DB branch must never vanish mid-run,
  // even right after its PR merges.
  const checkedOutSanitized = new Set<string>();
  try {
    execSync('git worktree list --porcelain', { encoding: 'utf-8' })
      .split('\n')
      .filter(l => l.startsWith('branch refs/heads/'))
      .forEach(l => checkedOutSanitized.add(sanitize(l.slice('branch refs/heads/'.length).trim())));
  } catch { /* worktrees unavailable — current-branch protection still applies */ }

  let deletedCount = 0;
  for (const branch of branches) {
    // Never delete the primary/main branch
    if (branch.primary || branch.default || branch.name === 'main' || branch.name.includes('main')) {
      continue;
    }

    let gitRef: string | undefined;   // the git branch this Neon branch serves
    let protectedReason: string | null = null;

    if (branch.name.startsWith('preview/')) {
      gitRef = branch.name.slice('preview/'.length);
      if (gitRef && remoteBranches.includes(gitRef) && !mergedIntoMain(gitRef)) {
        protectedReason = 'backs an open (unmerged) preview';
      }
    } else {
      gitRef = sanitizedToRaw.get(branch.name);
      if (branch.name === currentBranchSanitized) {
        protectedReason = 'current local git branch';
      } else if (checkedOutSanitized.has(branch.name)) {
        protectedReason = 'checked out in a worktree';
      } else if (gitRef && !mergedIntoMain(gitRef)) {
        protectedReason = 'git branch still active (unmerged)';
      } else if (!gitRef) {
        // Doesn't map to any remote git branch. Staleness can still be proven
        // two ways: a leftover LOCAL branch already merged into origin/main
        // (finished session that never got cleaned up), or a finished
        // (merged/closed) PR whose head ref this name matches. An unmerged
        // local branch is protected — it may be an active unpushed session.
        // Anything else could be a branch a human made by hand — leave alone.
        const localRaw = localSanitizedToRaw.get(branch.name);
        if (localRaw && !refMergedIntoMain(localRaw)) {
          protectedReason = 'local git branch exists (unmerged)';
        } else if (localRaw || finishedPrSanitized.has(branch.name)) {
          gitRef = branch.name; // stale: local branch merged, or PR finished
        } else {
          protectedReason = 'no matching git branch — not created by this tooling?';
        }
      }
    }

    if (protectedReason) {
      console.log(`⏭️  Keeping ${branch.name} (${protectedReason})`);
      continue;
    }

    console.log(`🗑️  ${DRY_RUN ? 'Would delete' : 'Deleting'} stale Neon branch: ${branch.name} (${branch.id})${gitRef ? ` — git branch '${gitRef}' is ${remoteBranches.includes(gitRef) ? 'merged' : 'gone'}` : ''}`);
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
