/**
 * Unit tests for the Neon stale-branch classifier
 * (scripts/lib/neon-branch-classifier.ts, used by scripts/cleanup-neon-branches.ts).
 * Run: npx tsx scripts/test-neon-branch-cleanup.ts  (part of `npm run mcp:lint`)
 *
 * Regression guards for the 2026-09-03 scheduled run that kept 8 branches it
 * should have deleted and deleted one it should have kept:
 *   - `includes('main')` treated `claude-distracted-germain-*` (ger·main) as the
 *     primary branch — it vanished from every keep AND delete line.
 *   - "gone from origin" was read as "not ours" — but GitHub deletes the head
 *     branch on merge, so every finished branch was retained forever.
 *   - The worktree protection the docs promised did not exist.
 */
import { classifyNeonBranch, sanitize, type GitState } from './lib/neon-branch-classifier';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}

// Fixture modelled on the real 2026-09-03 state (Neon and git names only — no
// customer data). `merged` lists refs that are ancestors of origin/main; both
// `origin/<name>` and bare local names resolve through it.
const merged = new Set([
  'origin/claude/merged-open-ref',
  'claude/zealous-nightingale-17b5cd',   // PR merged, origin ref deleted, local ref left behind
  'claude/distracted-germain-3d9e18',    // PR #88 merged; name contains "main"
  'claude/pr-72-review-merge-5e13c1',    // merged, but still checked out in a worktree
  'origin/claude/distracted-germain-3d9e18', // (not on origin any more; harmless)
]);
const git: GitState = {
  remoteBranches: ['main', 'claude/open-work', 'claude/merged-open-ref', 'claude/reverent-kalam-61e726'],
  localBranches: [
    'main',
    'claude/open-work',
    'claude/zealous-nightingale-17b5cd',
    'claude/distracted-germain-3d9e18',
    'claude/pr-72-review-merge-5e13c1',
    'claude/unpushed-session',
    'claude/reverent-kalam-61e726',
  ],
  checkedOutBranches: ['main', 'claude/pr-72-review-merge-5e13c1', 'claude/reverent-kalam-61e726'],
  currentBranch: 'claude/reverent-kalam-61e726',
  finishedPrHeadRefs: new Map([
    ['claude/gmail-write-allow-by-default', 'merged'],   // refs gone everywhere, PR #100 merged
    ['claude/abandoned-idea', 'closed'],
  ]),
  isMergedIntoMain: ref => merged.has(ref),
};

const verdict = (name: string, flags: { primary?: boolean; default?: boolean } = {}) =>
  classifyNeonBranch({ name, ...flags }, git);

console.log('sanitize:');
check('slashes and underscores become dashes, lowercased',
  sanitize('claude/Foo_bar.baz') === 'claude-foo-bar-baz');
check('is idempotent on an already-sanitized name',
  sanitize('claude-distracted-germain-3d9e18') === 'claude-distracted-germain-3d9e18');

console.log('primary-branch guard (Defect 2):');
check('exact name "main" is skipped', verdict('main').action === 'skip');
check('primary flag is skipped regardless of name', verdict('anything', { primary: true }).action === 'skip');
check('default flag is skipped regardless of name', verdict('anything', { default: true }).action === 'skip');
check('"claude-distracted-germain-3d9e18" (ger·main) is NOT primary',
  verdict('claude-distracted-germain-3d9e18').action !== 'skip');
check('"preview/claude/distracted-germain-3d9e18" is NOT primary',
  verdict('preview/claude/distracted-germain-3d9e18').action !== 'skip');
check('"claude-domain-model" is NOT primary', verdict('claude-domain-model').action !== 'skip');
check('"maintenance" is NOT primary', verdict('maintenance').action !== 'skip');
check('"main-2" is NOT primary', verdict('main-2').action !== 'skip');

console.log('merged-and-origin-deleted branches are stale (Defect 1):');
{
  const v = verdict('claude-zealous-nightingale-17b5cd');
  check('local ref merged + origin ref gone → delete', v.action === 'delete');
  check('  …with the local ref named in the reason',
    v.action === 'delete' && v.reason.includes("'claude/zealous-nightingale-17b5cd'") && v.gitRef === 'claude/zealous-nightingale-17b5cd');
}
check('germain: local ref merged + origin gone → delete',
  verdict('claude-distracted-germain-3d9e18').action === 'delete');
check('germain preview form: origin gone → delete',
  verdict('preview/claude/distracted-germain-3d9e18').action === 'delete');
{
  const v = verdict('claude-gmail-write-allow-by-default');
  check('no refs anywhere but PR merged → delete', v.action === 'delete');
  check('  …reason names the PR state', v.action === 'delete' && /merged/.test(v.reason));
}
check('no refs anywhere but PR closed → delete', verdict('claude-abandoned-idea').action === 'delete');
check('origin ref present and merged → delete', verdict('claude-merged-open-ref').action === 'delete');
check('preview form, origin ref merged → delete', verdict('preview/claude/merged-open-ref').action === 'delete');

console.log('conservative defaults are preserved:');
{
  const v = verdict('claude-stoic-pare-6de772');
  check('no origin ref, no local ref, no PR → keep', v.action === 'keep');
  check('  …with the "not created by this tooling?" reason', v.action === 'keep' && /not created by this tooling/.test(v.reason));
}
check('origin ref present and unmerged → keep', verdict('claude-open-work').action === 'keep');
check('preview backing an open PR → keep',
  verdict('preview/claude/open-work').action === 'keep' && verdict('preview/claude/open-work').reason.includes('open'));
check('origin gone, local ref unmerged → keep (may be an unpushed session)',
  verdict('claude-unpushed-session').action === 'keep');
check('hand-made branch name → keep', verdict('scratch-experiment').action === 'keep');

console.log('worktree protection wins over merged-branch deletion (Defect 3):');
{
  const v = verdict('claude-pr-72-review-merge-5e13c1');
  check('merged + origin gone, but checked out in a worktree → keep', v.action === 'keep');
  check('  …with a worktree reason', v.action === 'keep' && /worktree/.test(v.reason));
}
check('preview form of a worktree-checked-out branch → keep',
  verdict('preview/claude/pr-72-review-merge-5e13c1').action === 'keep');
check('current branch → keep',
  verdict('claude-reverent-kalam-61e726').action === 'keep' && verdict('claude-reverent-kalam-61e726').reason === 'current local git branch');
check('current branch, preview form → keep', verdict('preview/claude/reverent-kalam-61e726').action === 'keep');
check('detached HEAD (no current branch) still honours worktree list',
  classifyNeonBranch({ name: 'claude-pr-72-review-merge-5e13c1' }, { ...git, currentBranch: null }).action === 'keep');

console.log('degraded inputs:');
check('no worktree view + no PR view: merged local ref is still enough to delete',
  classifyNeonBranch({ name: 'claude-zealous-nightingale-17b5cd' },
    { ...git, checkedOutBranches: [], finishedPrHeadRefs: new Map() }).action === 'delete');
check('no PR view: refs-gone-everywhere branch is kept, not guessed',
  classifyNeonBranch({ name: 'claude-gmail-write-allow-by-default' },
    { ...git, finishedPrHeadRefs: new Map() }).action === 'keep');

if (failures > 0) {
  console.error(`\n${failures} neon-branch-cleanup test(s) failed`);
  process.exit(1);
}
console.log('\nAll neon-branch-cleanup tests passed.');
