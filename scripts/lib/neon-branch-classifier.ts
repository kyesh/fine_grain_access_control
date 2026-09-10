/**
 * Pure classifier for the Neon stale-branch pruner
 * (scripts/cleanup-neon-branches.ts). No I/O — every fact is passed in, so
 * scripts/test-neon-branch-cleanup.ts can exercise the rules directly.
 *
 * POLICY (set 2026-09-10, replacing the git-provenance rules):
 *
 *   A Neon branch is stale when it is older than 24h AND its compute has been
 *   idle for more than 6h. Nothing else is consulted — not whether the git
 *   branch merged, not whether a worktree still has it checked out, not
 *   whether a PR is open.
 *
 * Why the old rules went: they made staleness a property of *git*, and a
 * leftover worktree directory from a finished session pinned its database
 * branch forever. Branches accumulated indefinitely at $1.50/branch-month
 * while the work they backed had been merged for weeks. Age plus idleness
 * measures the thing we actually care about — nobody is using this database —
 * and a branch that turns out to be wanted again is one `npm run db:branch`
 * away (a fresh copy of main; accumulated QA state does not survive).
 *
 * Guards that remain:
 *   1. The primary/default branch and a branch named exactly `main` are never
 *      touched. Exact match only — a substring test once hid every branch
 *      whose name merely CONTAINED "main" (ger·main, do·main…) from the run
 *      output entirely.
 *   2. A branch Neon reports as `protected` is never touched. This is the
 *      opt-out for a long-lived branch that must outlive the timers: mark it
 *      protected in the Neon console.
 *   3. A branch whose compute is running RIGHT NOW is kept regardless of age.
 *      A live dev server or preview must never lose its database mid-request.
 *
 * Idleness comes from the compute endpoint's `last_active`, not the branch's
 * `updated_at` — `updated_at` is bumped by unrelated project-level metadata
 * operations (a sibling branch being deleted moves it), so it reads as
 * "active" for branches nothing has connected to in weeks. A branch with no
 * endpoint at all has never served a query: it is idle for its whole life.
 */

/** Minimum branch age before deletion is even considered. */
export const AGE_THRESHOLD_HOURS = 24;
/** Minimum time since the last compute activity before deletion. */
export const IDLE_THRESHOLD_HOURS = 6;

const HOUR_MS = 60 * 60 * 1000;

export interface NeonEndpointLike {
  branch_id?: string;
  /** `active` means compute is running now; `idle` means suspended. */
  current_state?: string;
  last_active?: string | null;
}

export interface NeonBranchLike {
  id?: string;
  name: string;
  primary?: boolean;
  default?: boolean;
  protected?: boolean;
  created_at?: string;
}

export type Verdict =
  | { action: 'skip'; reason: string }
  | { action: 'keep'; reason: string }
  | { action: 'delete'; reason: string };

const hoursSince = (iso: string | null | undefined, now: Date): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / HOUR_MS;
};

const fmt = (h: number) => (h < 48 ? `${h.toFixed(1)}h` : `${Math.round(h / 24)}d`);

/**
 * @param endpoints The compute endpoints belonging to THIS branch (already
 *   filtered by `branch_id`). An empty list means no compute has ever run.
 */
export function classifyNeonBranch(
  branch: NeonBranchLike,
  endpoints: NeonEndpointLike[],
  now: Date = new Date()
): Verdict {
  if (branch.primary || branch.default || branch.name === 'main') {
    return { action: 'skip', reason: 'primary branch' };
  }
  if (branch.protected) {
    return { action: 'keep', reason: 'marked protected in Neon' };
  }

  if (endpoints.some(e => e.current_state === 'active')) {
    return { action: 'keep', reason: 'compute is running right now' };
  }

  const ageHours = hoursSince(branch.created_at, now);
  if (ageHours === null) {
    // No usable creation timestamp = no way to prove the age floor. Age is the
    // one fact the policy cannot infer from anything else, so refuse to guess.
    return { action: 'keep', reason: 'no readable created_at — cannot age it' };
  }
  if (ageHours < AGE_THRESHOLD_HOURS) {
    return { action: 'keep', reason: `created ${fmt(ageHours)} ago (under ${AGE_THRESHOLD_HOURS}h)` };
  }

  // Most recent activity across every endpoint on the branch. None recorded =
  // nothing ever connected, so it has been idle since it was created.
  const idleCandidates = endpoints
    .map(e => hoursSince(e.last_active, now))
    .filter((h): h is number => h !== null);
  const idleHours = idleCandidates.length > 0 ? Math.min(...idleCandidates) : ageHours;

  if (idleHours < IDLE_THRESHOLD_HOURS) {
    return { action: 'keep', reason: `active ${fmt(idleHours)} ago (under ${IDLE_THRESHOLD_HOURS}h)` };
  }

  const idleNote = idleCandidates.length > 0 ? `idle ${fmt(idleHours)}` : 'never connected to';
  return { action: 'delete', reason: `created ${fmt(ageHours)} ago, ${idleNote}` };
}
