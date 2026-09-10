/**
 * Unit tests for the Neon stale-branch classifier
 * (scripts/lib/neon-branch-classifier.ts, used by scripts/cleanup-neon-branches.ts).
 * Run: npx tsx scripts/test-neon-branch-cleanup.ts  (part of `npm run mcp:lint`)
 *
 * The policy under test (2026-09-10):
 *   - a merged local-dev branch (`<sanitized-git-branch>`) goes IMMEDIATELY;
 *   - everything else needs idle > 6h AND (age > 24h OR its PR is merged).
 * Guards: primary branch, Neon-`protected` branches, and any branch whose
 * compute is running right now — the last is the only thing protecting a
 * merged local-dev branch, so its coverage below is load-bearing.
 *
 * The load-bearing invariant, asserted below: git state may only ACCELERATE
 * deletion. An empty merged-ref map (no `gh`, no network) must fall back to the
 * 24h clock and never keep a branch alive — a git fact used as a KEEP is the
 * exact bug this policy replaced.
 *
 * Regression guards carried over from the git-provenance era:
 *   - `includes('main')` treated `claude-distracted-germain-*` (ger·main) as
 *     the primary branch — it vanished from every keep AND delete line.
 *   - Branch `updated_at` was proposed as the idleness signal; it is bumped by
 *     unrelated project metadata operations, so an untouched branch reads as
 *     freshly active. Only endpoint `last_active` counts.
 */
import {
  classifyNeonBranch,
  AGE_THRESHOLD_HOURS,
  IDLE_THRESHOLD_HOURS,
  sanitize,
  type NeonBranchLike,
  type NeonEndpointLike,
  type MergedRefs,
} from './lib/neon-branch-classifier';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}

const NOW = new Date('2026-09-10T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const branch = (name: string, ageHours: number, extra: Partial<NeonBranchLike> = {}): NeonBranchLike =>
  ({ id: `br-${name}`, name, created_at: hoursAgo(ageHours), ...extra });
const idleEndpoint = (idleHours: number): NeonEndpointLike =>
  ({ current_state: 'idle', last_active: hoursAgo(idleHours) });
const activeEndpoint = (): NeonEndpointLike =>
  ({ current_state: 'active', last_active: hoursAgo(0) });

const verdict = (b: NeonBranchLike, eps: NeonEndpointLike[] = [], merged: MergedRefs = new Map()) =>
  classifyNeonBranch(b, eps, NOW, merged);
const MERGED: MergedRefs = new Map([['claude/shipped-work', '#128'], ['fgac/readme-tidy', '#133']]);

console.log('thresholds:');
check('age threshold is 24h', AGE_THRESHOLD_HOURS === 24);
check('idle threshold is 6h', IDLE_THRESHOLD_HOURS === 6);

console.log('primary-branch guard:');
check('exact name "main" is skipped', verdict(branch('main', 4000), [idleEndpoint(4000)]).action === 'skip');
check('primary flag is skipped regardless of name',
  verdict(branch('anything', 4000, { primary: true }), [idleEndpoint(4000)]).action === 'skip');
check('default flag is skipped regardless of name',
  verdict(branch('anything', 4000, { default: true }), [idleEndpoint(4000)]).action === 'skip');
check('"claude-distracted-germain-3d9e18" (ger·main) is NOT primary',
  verdict(branch('claude-distracted-germain-3d9e18', 400), [idleEndpoint(400)]).action === 'delete');
check('"preview/claude/distracted-germain-3d9e18" is NOT primary',
  verdict(branch('preview/claude/distracted-germain-3d9e18', 400), [idleEndpoint(400)]).action === 'delete');
check('"claude-domain-model" is NOT primary',
  verdict(branch('claude-domain-model', 400), [idleEndpoint(400)]).action === 'delete');
check('"maintenance" is NOT primary',
  verdict(branch('maintenance', 400), [idleEndpoint(400)]).action === 'delete');
check('"main-2" is NOT primary',
  verdict(branch('main-2', 400), [idleEndpoint(400)]).action === 'delete');

console.log('the age floor:');
check('1h old, idle since creation → keep',
  verdict(branch('claude-fresh', 1), [idleEndpoint(1)]).action === 'keep');
check('23.9h old and long idle → keep (age floor beats idleness)',
  verdict(branch('claude-almost', 23.9), [idleEndpoint(23.9)]).action === 'keep');
check('  …with an age reason',
  /under 24h/.test(verdict(branch('claude-almost', 23.9), [idleEndpoint(23.9)]).reason));
check('24.1h old and long idle → delete',
  verdict(branch('claude-just-over', 24.1), [idleEndpoint(24.1)]).action === 'delete');

console.log('the idle floor:');
check('old but active 1h ago → keep',
  verdict(branch('claude-in-use', 300), [idleEndpoint(1)]).action === 'keep');
check('  …with an idle reason', /under 6h/.test(verdict(branch('claude-in-use', 300), [idleEndpoint(1)]).reason));
check('old, active 5.9h ago → keep',
  verdict(branch('claude-recent', 300), [idleEndpoint(5.9)]).action === 'keep');
check('old, active 6.1h ago → delete',
  verdict(branch('claude-cold', 300), [idleEndpoint(6.1)]).action === 'delete');
check('most-recently-active endpoint wins across several endpoints',
  verdict(branch('claude-multi', 300), [idleEndpoint(200), idleEndpoint(2)]).action === 'keep');

console.log('running compute is never deleted:');
{
  const v = verdict(branch('claude-live-session', 4000), [activeEndpoint()]);
  check('ancient branch with active compute → keep', v.action === 'keep');
  check('  …with a running-compute reason', /running right now/.test(v.reason));
}
check('one active endpoint protects the branch even alongside idle ones',
  verdict(branch('claude-mixed', 4000), [idleEndpoint(900), activeEndpoint()]).action === 'keep');

console.log('protected branches opt out:');
check('Neon-protected branch is kept however old and idle',
  verdict(branch('long-lived-fixture', 4000, { protected: true }), [idleEndpoint(4000)]).action === 'keep');

console.log('endpoints missing or unreadable:');
{
  const v = verdict(branch('claude-never-used', 400), []);
  check('no endpoint at all + past the age floor → delete', v.action === 'delete');
  check('  …reason says it was never connected to', /never connected/.test(v.reason));
}
check('no endpoint but under the age floor → keep',
  verdict(branch('claude-brand-new', 2), []).action === 'keep');
check('endpoint with a null last_active falls back to branch age',
  verdict(branch('claude-null-active', 400), [{ current_state: 'idle', last_active: null }]).action === 'delete');
check('unparseable created_at → keep, never guessed',
  verdict({ id: 'br-x', name: 'claude-broken', created_at: 'not-a-date' }, [idleEndpoint(900)]).action === 'keep');
check('missing created_at → keep, never guessed',
  verdict({ id: 'br-x', name: 'claude-no-date' }, [idleEndpoint(900)]).action === 'keep');

console.log('git provenance never KEEPS a branch:');
check('a branch whose git branch is still open is deleted once cold',
  verdict(branch('preview/claude/open-pr-but-cold', 120), [idleEndpoint(48)]).action === 'delete');
check('a hand-made branch with no git branch is deleted once cold',
  verdict(branch('claude-stoic-pare-6de772', 405), [idleEndpoint(320)]).action === 'delete');
check('an unmerged ref past both timers is still deleted',
  verdict(branch('preview/claude/never-merged', 120), [idleEndpoint(48)], MERGED).action === 'delete');

console.log('sanitize maps db:branch names back to git refs:');
check('slashes become dashes, lowercased', sanitize('claude/Foo_bar.baz') === 'claude-foo-bar-baz');
check('already-sanitized names are unchanged', sanitize('claude-shipped-work') === 'claude-shipped-work');

console.log('a merged PR drops the 24h requirement:');
{
  const v = verdict(branch('preview/claude/shipped-work', 3), [idleEndpoint(7)], MERGED);
  check('preview form, 3h old but merged and 7h idle → delete', v.action === 'delete');
  check('  …reason names the PR', v.reason.includes('#128') && /merged/.test(v.reason));
  check('  …and it is eligible now', v.metrics.eligibleInHours === 0);
}
check('local-dev (sanitized) form of a merged ref → delete',
  verdict(branch('claude-shipped-work', 3), [idleEndpoint(7)], MERGED).action === 'delete');
check('a merged ref with a slash-heavy name maps through sanitize',
  verdict(branch('fgac-readme-tidy', 2), [idleEndpoint(7)], MERGED).action === 'delete');
check('same branch WITHOUT the merged map → kept by the 24h floor',
  verdict(branch('claude-shipped-work', 3), [idleEndpoint(7)]).action === 'keep');

console.log('a merged LOCAL-DEV branch skips the idle wait entirely:');
{
  const v = verdict(branch('claude-shipped-work', 0.1), [idleEndpoint(0.1)], MERGED);
  check('merged, 6 minutes old, active 6 minutes ago → delete anyway', v.action === 'delete');
  check('  …reason says why the idle wait did not apply', /no idle wait/.test(v.reason));
  check('  …and it is eligible now', v.metrics.eligibleInHours === 0);
}
check('an UNMERGED local-dev branch still owes both timers',
  verdict(branch('claude-open-work', 0.1), [idleEndpoint(0.1)], MERGED).action === 'keep');

console.log('the 6h idle floor still guards merged PREVIEWS:');
{
  const v = verdict(branch('preview/claude/shipped-work', 3), [idleEndpoint(1)], MERGED);
  check('merged preview but active 1h ago → keep', v.action === 'keep');
  check('  …with the idle reason', /under 6h/.test(v.reason));
  check('  …and only the idle timer left to wait (5h)',
    Math.abs((v.metrics.eligibleInHours ?? 0) - 5) < 1e-9);
}
check('merged preview, idle 7h → delete',
  verdict(branch('preview/claude/shipped-work', 8), [idleEndpoint(7)], MERGED).action === 'delete');

console.log('the guards still beat a merged local-dev branch:');
check('merged but compute running right now → keep (the ONLY protection left)',
  verdict(branch('claude-shipped-work', 300), [activeEndpoint()], MERGED).action === 'keep');
check('merged, brand new, compute running → keep',
  verdict(branch('claude-shipped-work', 0.1), [activeEndpoint()], MERGED).action === 'keep');
check('merged but marked protected → keep',
  verdict(branch('claude-shipped-work', 300, { protected: true }), [idleEndpoint(50)], MERGED).action === 'keep');
check('merged does NOT override the primary-branch guard',
  verdict(branch('main', 300, { primary: true }), [idleEndpoint(50)], MERGED).action === 'skip');

console.log('degraded PR lookup falls back to the clock, never to keeping:');
check('empty merged map: young branch kept exactly as before',
  verdict(branch('claude-shipped-work', 3), [idleEndpoint(7)], new Map()).action === 'keep');
check('empty merged map: a brand-new local-dev branch is NOT deleted',
  verdict(branch('claude-shipped-work', 0.1), [idleEndpoint(0.1)], new Map()).action === 'keep');
check('empty merged map: old cold branch still deleted',
  verdict(branch('claude-shipped-work', 300), [idleEndpoint(50)], new Map()).action === 'delete');

console.log('metrics reported alongside the verdict (feeds the kept-branch table):');
{
  const v = verdict(branch('claude-young', 10), [idleEndpoint(3)]);
  check('age and idle are surfaced', v.metrics.ageHours === 10 && v.metrics.idleHours === 3);
  check('eligibility waits on the SLOWER timer (age here, 14h out)',
    Math.abs((v.metrics.eligibleInHours ?? 0) - 14) < 1e-9);
}
{
  const v = verdict(branch('claude-old-but-warm', 300), [idleEndpoint(2)]);
  check('past the age floor, eligibility waits on idleness (4h out)',
    Math.abs((v.metrics.eligibleInHours ?? 0) - 4) < 1e-9);
}
check('a deleted branch reports 0h to eligibility',
  verdict(branch('claude-cold', 300), [idleEndpoint(50)]).metrics.eligibleInHours === 0);
check('running compute is not on a timer at all',
  verdict(branch('claude-live', 300), [activeEndpoint()]).metrics.eligibleInHours === null);
check('a protected branch is not on a timer at all',
  verdict(branch('claude-pinned', 300, { protected: true }), [idleEndpoint(50)]).metrics.eligibleInHours === null);
check('no endpoint: idle equals age, so the table shows a real number',
  verdict(branch('claude-never-used', 10), []).metrics.idleHours === 10);

if (failures > 0) {
  console.error(`\n${failures} neon-branch-cleanup test(s) failed`);
  process.exit(1);
}
console.log('\nAll neon-branch-cleanup tests passed.');
