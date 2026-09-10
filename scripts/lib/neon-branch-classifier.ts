/**
 * Pure classifier for the Neon stale-branch pruner
 * (scripts/cleanup-neon-branches.ts). No I/O — every fact is passed in, so
 * scripts/test-neon-branch-cleanup.ts can exercise the rules directly.
 *
 * POLICY (set 2026-09-10):
 *
 *   A local-dev branch (`<sanitized-git-branch>`, made by `npm run db:branch`)
 *   whose PR is merged is deleted IMMEDIATELY — no idle wait. The work is
 *   finished and exactly one machine's dev server could be using it, which the
 *   running-compute guard already covers.
 *
 *   Every other branch is stale when its compute has been idle more than 6h AND
 *   either
 *     (a) it is older than 24h, or
 *     (b) the PR for its git branch is merged.
 *
 *   The asymmetry is deliberate. A `preview/<git-branch>` branch serves a
 *   deployed URL that anyone can hit at any moment, and Neon suspends compute
 *   between requests — so "idle" there does not mean "unused", and the 6h floor
 *   is what stops a merge from killing a preview somebody is looking at. A
 *   local-dev branch has one consumer on one machine, and if its dev server is
 *   actually running, `current_state === 'active'` keeps it.
 *
 * THE INVARIANT: git state may only ACCELERATE deletion, never prevent it.
 * The original bug was a git fact used as a KEEP — "checked out in a worktree"
 * — which let a leftover directory pin a database branch forever. A merged PR
 * can bring deletion forward; nothing about git can push it back. So when the
 * PR lookup fails (no `gh`, no network) the pruner simply falls back to the
 * 24h clock: less prompt, never wrong.
 *
 * Why the old rules went: they made staleness a property of *git*, and a
 * leftover worktree directory from a finished session pinned its database
 * branch forever. Branches accumulated indefinitely at $1.50/branch-month
 * while the work they backed had been merged for weeks. Idleness measures the
 * thing we actually care about — nobody is using this database — and a branch
 * that turns out to be wanted again is one `npm run db:branch` away (a fresh
 * copy of main; accumulated QA state does not survive).
 *
 * The 6h idle floor is what makes the merged path safe FOR PREVIEWS: merging
 * does not mean every caller has stopped hitting the URL, and Neon's compute
 * suspends after a few minutes, so `current_state === 'active'` alone would not
 * catch traffic that is merely between requests. Local-dev branches opt out of
 * that floor by Ken's instruction (2026-09-10): merging is the end of that
 * branch's life, and a dev server left running is caught by the same guard.
 *
 * Guards that remain:
 *   1. The primary/default branch and a branch named exactly `main` are never
 *      touched. Exact match only — a substring test once hid every branch
 *      whose name merely CONTAINED "main" (ger·main, do·main…) from the run
 *      output entirely.
 *   2. A branch Neon reports as `protected` is never touched. This is the
 *      opt-out for a long-lived branch that must outlive the timers: mark it
 *      protected in the Neon console.
 *   3. A branch whose compute is running RIGHT NOW is kept regardless of age
 *      or merge state. A live dev server or preview must never lose its
 *      database mid-request.
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

/**
 * `npm run db:branch` sanitizes the git branch name for its Neon branch, so
 * `claude/foo-bar` becomes `claude-foo-bar`. Preview branches keep the raw name
 * behind a `preview/` prefix. Both shapes must map back to a git ref to match a
 * merged PR.
 */
export const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();

export interface NeonBranchLike {
  id?: string;
  name: string;
  primary?: boolean;
  default?: boolean;
  protected?: boolean;
  created_at?: string;
}

/**
 * Measurements behind the verdict, so callers can tabulate without recomputing
 * them (and without a second, divergent copy of the arithmetic).
 * `eligibleInHours` is how long until a kept branch becomes deletable, or null
 * when no timer will get it there (running compute, protected, unreadable age).
 */
export interface VerdictMetrics {
  ageHours: number | null;
  idleHours: number | null;
  eligibleInHours: number | null;
}

export type Verdict = { reason: string; metrics: VerdictMetrics } & (
  | { action: 'skip' }
  | { action: 'keep' }
  | { action: 'delete' }
);

const hoursSince = (iso: string | null | undefined, now: Date): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / HOUR_MS;
};

const fmt = (h: number) => (h < 48 ? `${h.toFixed(1)}h` : `${Math.round(h / 24)}d`);

/**
 * Head refs of MERGED pull requests, mapped to a label for the log line
 * (e.g. `claude/foo` -> `#128`). Only include a ref whose LATEST PR is merged —
 * a reused branch name with a newer open PR is still live work.
 */
export type MergedRefs = Map<string, string>;

/** Which git ref, if any, this Neon branch came from, and its merged label. */
const mergedLabelFor = (branchName: string, merged: MergedRefs): string | null => {
  if (merged.size === 0) return null;
  if (branchName.startsWith('preview/')) {
    return merged.get(branchName.slice('preview/'.length)) ?? null;
  }
  for (const [ref, label] of merged) if (sanitize(ref) === branchName) return label;
  return null;
};

/**
 * @param endpoints The compute endpoints belonging to THIS branch (already
 *   filtered by `branch_id`). An empty list means no compute has ever run.
 * @param merged Head refs of merged PRs. Empty (the caller could not reach
 *   GitHub) degrades to the 24h clock — it never keeps a branch alive.
 */
export function classifyNeonBranch(
  branch: NeonBranchLike,
  endpoints: NeonEndpointLike[],
  now: Date = new Date(),
  merged: MergedRefs = new Map()
): Verdict {
  const ageHours = hoursSince(branch.created_at, now);
  // Most recent activity across every endpoint on the branch. None recorded =
  // nothing ever connected, so it has been idle since it was created.
  const idleCandidates = endpoints
    .map(e => hoursSince(e.last_active, now))
    .filter((h): h is number => h !== null);
  const idleHours = idleCandidates.length > 0
    ? Math.min(...idleCandidates)
    : ageHours;

  const never: VerdictMetrics = { ageHours, idleHours, eligibleInHours: null };

  if (branch.primary || branch.default || branch.name === 'main') {
    return { action: 'skip', reason: 'primary branch', metrics: never };
  }
  if (branch.protected) {
    return { action: 'keep', reason: 'marked protected in Neon', metrics: never };
  }
  if (endpoints.some(e => e.current_state === 'active')) {
    return { action: 'keep', reason: 'compute is running right now', metrics: never };
  }
  if (ageHours === null) {
    // No usable creation timestamp = no way to prove the age floor. Age is the
    // one fact the policy cannot infer from anything else, so refuse to guess.
    return { action: 'keep', reason: 'no readable created_at — cannot age it', metrics: never };
  }

  const mergedLabel = mergedLabelFor(branch.name, merged);
  const isPreview = branch.name.startsWith('preview/');
  const effectiveIdle = idleHours ?? ageHours;

  // A merged local-dev branch is eligible the moment we see it; a merged
  // preview still owes the idle timer; anything unmerged owes the slower of the
  // two. All of these assume nothing connects meanwhile — that resets idleness.
  const waitForIdle = IDLE_THRESHOLD_HOURS - effectiveIdle;
  const eligibleInHours = mergedLabel !== null
    ? (isPreview ? waitForIdle : 0)
    : Math.max(AGE_THRESHOLD_HOURS - ageHours, waitForIdle);
  const metrics: VerdictMetrics = { ageHours, idleHours, eligibleInHours };

  const idleNote = idleCandidates.length > 0 ? `idle ${fmt(effectiveIdle)}` : 'never connected to';

  // Merged local-dev branch: gone now. The running-compute guard above is the
  // only thing standing between a merge and this branch, by design.
  if (mergedLabel !== null && !isPreview) {
    return {
      action: 'delete',
      reason: `PR ${mergedLabel} merged (local dev branch — no idle wait)`,
      metrics: { ...metrics, eligibleInHours: 0 },
    };
  }

  if (effectiveIdle < IDLE_THRESHOLD_HOURS) {
    // Previews only: merging does not prove every caller has stopped hitting
    // the deployed URL, only that the work is done.
    return {
      action: 'keep',
      reason: `active ${fmt(effectiveIdle)} ago (under ${IDLE_THRESHOLD_HOURS}h)`,
      metrics,
    };
  }

  if (mergedLabel !== null) {
    return {
      action: 'delete',
      reason: `PR ${mergedLabel} merged, ${idleNote}`,
      metrics: { ...metrics, eligibleInHours: 0 },
    };
  }

  if (ageHours < AGE_THRESHOLD_HOURS) {
    return {
      action: 'keep',
      reason: `created ${fmt(ageHours)} ago (under ${AGE_THRESHOLD_HOURS}h)`,
      metrics,
    };
  }

  return {
    action: 'delete',
    reason: `created ${fmt(ageHours)} ago, ${idleNote}`,
    metrics: { ...metrics, eligibleInHours: 0 },
  };
}
