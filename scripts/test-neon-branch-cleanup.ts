/**
 * Unit tests for the Neon stale-branch classifier
 * (scripts/lib/neon-branch-classifier.ts, used by scripts/cleanup-neon-branches.ts).
 * Run: npx tsx scripts/test-neon-branch-cleanup.ts  (part of `npm run mcp:lint`)
 *
 * The policy under test (2026-09-10): delete when older than 24h AND idle for
 * more than 6h. Guards: primary branch, Neon-`protected` branches, and any
 * branch whose compute is running right now.
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
  type NeonBranchLike,
  type NeonEndpointLike,
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

const verdict = (b: NeonBranchLike, eps: NeonEndpointLike[] = []) => classifyNeonBranch(b, eps, NOW);

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

console.log('git provenance is deliberately NOT consulted:');
check('a branch whose git branch is still open is deleted once cold',
  verdict(branch('preview/claude/open-pr-but-cold', 120), [idleEndpoint(48)]).action === 'delete');
check('a hand-made branch with no git branch is deleted once cold',
  verdict(branch('claude-stoic-pare-6de772', 405), [idleEndpoint(320)]).action === 'delete');

if (failures > 0) {
  console.error(`\n${failures} neon-branch-cleanup test(s) failed`);
  process.exit(1);
}
console.log('\nAll neon-branch-cleanup tests passed.');
