/**
 * Pure classifier for the Neon stale-branch pruner
 * (scripts/cleanup-neon-branches.ts). No I/O — every git fact is passed in,
 * so scripts/test-neon-branch-cleanup.ts can exercise the rules directly.
 *
 * Two Neon branch shapes map back to git branches:
 *   - `preview/<git-branch>`      — Vercel preview integration, raw git name
 *   - `<sanitize(git-branch)>`    — local dev via `npm run db:branch`
 *
 * Precedence (first match wins):
 *   1. primary / default / exactly `main`            → skip (never logged)
 *   2. checked out in ANY git worktree (either form) → keep
 *   3. preview/: origin ref present and unmerged     → keep, else delete
 *   4. plain: origin ref present and unmerged        → keep
 *   5. plain: origin ref gone —
 *        local ref present and unmerged             → keep
 *        local ref present and merged               → delete
 *        head ref of a merged/closed PR             → delete
 *        nothing resolves                           → keep (unknown ≠ stale)
 */

export const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();

export interface NeonBranchLike {
  name: string;
  primary?: boolean;
  default?: boolean;
}

export interface GitState {
  /** Raw branch names present on origin (`git ls-remote --heads origin`). */
  remoteBranches: string[];
  /** Raw local branch names (`refs/heads/*`), including other worktrees' branches. */
  localBranches: string[];
  /** Raw branch names checked out in any worktree (`git worktree list --porcelain`). */
  checkedOutBranches: string[];
  /** Raw name of the branch checked out in this working tree, if any. */
  currentBranch: string | null;
  /** Raw head-ref names of finished (merged or closed) PRs; keyed by state. */
  finishedPrHeadRefs: Map<string, 'merged' | 'closed'>;
  /** `git merge-base --is-ancestor <ref> origin/main`. `ref` is `origin/<name>` or a local name. */
  isMergedIntoMain: (ref: string) => boolean;
}

export type Verdict =
  | { action: 'skip'; reason: 'primary branch' }
  | { action: 'keep'; reason: string }
  | { action: 'delete'; reason: string; gitRef: string };

export function classifyNeonBranch(branch: NeonBranchLike, git: GitState): Verdict {
  // Exact match only — `includes('main')` once hid `claude-distracted-germain-*`
  // (ger·main) from every keep AND delete line of the run output.
  if (branch.primary || branch.default || branch.name === 'main') {
    return { action: 'skip', reason: 'primary branch' };
  }

  const isPreview = branch.name.startsWith('preview/');
  const previewRef = isPreview ? branch.name.slice('preview/'.length) : undefined;
  // The sanitized key both shapes share, so worktree protection covers
  // `preview/claude/foo` and `claude-foo` alike.
  const key = isPreview ? sanitize(previewRef!) : branch.name;

  const checkedOut = new Set(git.checkedOutBranches.map(sanitize));
  if (git.currentBranch !== null && sanitize(git.currentBranch) === key) {
    return { action: 'keep', reason: 'current local git branch' };
  }
  if (checkedOut.has(key)) {
    return { action: 'keep', reason: 'checked out in a git worktree' };
  }

  const remoteSanitized = new Map<string, string>();
  for (const b of git.remoteBranches) remoteSanitized.set(sanitize(b), b);

  if (isPreview) {
    const gitRef = previewRef!;
    if (git.remoteBranches.includes(gitRef)) {
      if (!git.isMergedIntoMain(`origin/${gitRef}`)) {
        return { action: 'keep', reason: 'backs an open (unmerged) preview' };
      }
      return { action: 'delete', reason: `git branch '${gitRef}' merged into origin/main`, gitRef };
    }
    return { action: 'delete', reason: `git branch '${gitRef}' gone from origin`, gitRef };
  }

  const remoteRaw = remoteSanitized.get(key);
  if (remoteRaw) {
    if (!git.isMergedIntoMain(`origin/${remoteRaw}`)) {
      return { action: 'keep', reason: 'git branch still active (unmerged)' };
    }
    return { action: 'delete', reason: `git branch '${remoteRaw}' merged into origin/main`, gitRef: remoteRaw };
  }

  // Origin ref is gone. GitHub deletes the head branch on merge, so this is the
  // NORMAL end-of-life state for finished work — not evidence of a hand-made
  // branch. Prove staleness from what remains before giving up.
  const localRaw = git.localBranches.find(b => sanitize(b) === key);
  if (localRaw) {
    if (!git.isMergedIntoMain(localRaw)) {
      return { action: 'keep', reason: 'local git branch exists (unmerged)' };
    }
    return {
      action: 'delete',
      reason: `local git branch '${localRaw}' merged into origin/main, origin ref deleted`,
      gitRef: localRaw,
    };
  }
  for (const [headRef, state] of git.finishedPrHeadRefs) {
    if (sanitize(headRef) === key) {
      return { action: 'delete', reason: `PR for '${headRef}' ${state}, git refs gone`, gitRef: headRef };
    }
  }
  return { action: 'keep', reason: 'no matching git branch anywhere — not created by this tooling?' };
}
