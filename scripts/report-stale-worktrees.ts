/* eslint-disable */
import { execSync } from 'child_process'

/**
 * Report git worktrees that look finished. REPORT ONLY — this script never
 * removes anything, by design.
 *
 * It is deliberately separate from the Neon pruner. Since 2026-09-10 the
 * pruner deletes by age and idleness alone and no longer cares whether a
 * worktree has a branch checked out, so leftover directories cost nothing in
 * database billing — they are only filesystem clutter, and removing one is a
 * judgement call this script is not entitled to make: a directory can be the
 * cwd of a live session even when its branch is merged and its tree is clean.
 *
 * A worktree is reported as prunable when its HEAD is an ancestor of
 * origin/main AND `git status --porcelain` is empty. Anything with uncommitted
 * or untracked files is listed separately and never suggested for removal.
 *
 * Deleting a worktree does not lose the database: `npm run db:branch` recreates
 * a branch from main whenever the work is picked up again.
 *
 * Run: npx tsx scripts/report-stale-worktrees.ts
 */

const sh = (cmd: string, cwd?: string) =>
  execSync(cmd, { encoding: 'utf-8', cwd, stdio: ['ignore', 'pipe', 'ignore'] }).trim();

interface Worktree { path: string; branch: string | null; head: string }

function listWorktrees(): Worktree[] {
  const out = sh('git worktree list --porcelain');
  const trees: Worktree[] = [];
  let current: Partial<Worktree> = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) trees.push(current as Worktree);
      current = { path: line.slice('worktree '.length), branch: null, head: '' };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length);
    }
  }
  if (current.path) trees.push(current as Worktree);
  return trees;
}

function main() {
  // The merged checks below compare against origin/main, so a stale remote ref
  // would report unmerged work as prunable. Refuse to report on a stale view.
  try {
    sh('git fetch origin --quiet');
  } catch {
    console.error('❌ Could not fetch origin — refusing to judge worktrees against a stale origin/main.');
    process.exit(1);
  }

  const mainPath = sh('git rev-parse --path-format=absolute --git-common-dir').replace(/\/\.git$/, '');
  const trees = listWorktrees().filter(w => w.path !== mainPath);

  const prunable: Worktree[] = [];
  const dirty: { tree: Worktree; changes: number }[] = [];
  const active: Worktree[] = [];

  for (const tree of trees) {
    let merged = false;
    try {
      sh(`git merge-base --is-ancestor "${tree.head}" origin/main`);
      merged = true;
    } catch { /* not an ancestor of main */ }

    let changes = 0;
    try {
      const status = sh('git status --porcelain', tree.path);
      changes = status ? status.split('\n').length : 0;
    } catch {
      // Unreadable tree — treat as dirty rather than suggesting removal.
      changes = -1;
    }

    if (!merged) active.push(tree);
    else if (changes !== 0) dirty.push({ tree, changes });
    else prunable.push(tree);
  }

  console.log(`🌲 ${trees.length} worktree(s) besides the main checkout.\n`);

  if (prunable.length > 0) {
    console.log(`✅ ${prunable.length} finished (merged into origin/main, nothing uncommitted):`);
    for (const t of prunable) console.log(`   ${t.branch ?? '(detached)'}  —  ${t.path}`);
    console.log('\n   Remove the ones no session is using:');
    for (const t of prunable) console.log(`   git worktree remove "${t.path}"`);
    console.log('');
  }

  if (dirty.length > 0) {
    console.log(`✋ ${dirty.length} merged but NOT clean — uncommitted or untracked files, review by hand:`);
    for (const { tree, changes } of dirty) {
      const note = changes < 0 ? 'unreadable' : `${changes} change(s)`;
      console.log(`   ${tree.branch ?? '(detached)'}  (${note})  —  ${tree.path}`);
    }
    console.log('');
  }

  if (active.length > 0) {
    console.log(`🔧 ${active.length} still carrying unmerged work:`);
    for (const t of active) console.log(`   ${t.branch ?? '(detached)'}  —  ${t.path}`);
    console.log('');
  }

  console.log('This script never removes anything — a clean, merged worktree can still be a live session\'s cwd.');
}

main();
