# Neon branches — revision 4: merged local branches go at once; a creation check

**Branch:** `claude/adoring-keller-6c98ea` · **Date:** 2026-09-10 · Supersedes v3

## 1. A merged PR deletes its local branch immediately

```
merged + local-dev (<sanitized-branch>)  → delete now, no idle wait
merged + preview/<branch>                → delete once idle > 6h
unmerged                                 → delete once idle > 6h AND age > 24h
```

Guards are unchanged and still win over everything: primary/`main`, `protected`
in Neon, and running compute.

**Why the asymmetry.** A `preview/` branch serves a deployed URL that anyone can
hit at any moment, and Neon suspends compute between requests — so "idle" there
does not mean "unused", and the 6h floor is what stops a merge from killing a
preview somebody is looking at. A local-dev branch has one consumer on one
machine, and a dev server that is genuinely running is caught by the
running-compute guard.

**The risk this accepts, stated plainly:** compute suspends after a few minutes,
so a dev server sitting idle *between* queries does not read as running. Merge a
PR while its worktree still has a server up and the next prune takes that
database. Recovery is `npm run db:branch`, but the QA state in it is gone.
Documented in CLAUDE.md as: finish QA against a branch before merging, not
after.

If previews should behave the same way, it is one line — drop the `!isPreview`
condition in `classifyNeonBranch`.

## 2. `npm run branches:creation-report` — should creation change?

The pruner only decides deletion. This answers the other half: **how many
branches get provisioned that nobody ever queries?** Evidence is
`cpu_used_sec === 0` — created, endpoint attached, no compute ever ran.

It splits results by creator, because the two have different levers and
conflating them yields advice nobody can act on:

| created by | when | the lever |
| --- | --- | --- |
| `vercel-neon` | automatically, every preview deploy | the Vercel–Neon integration setting — **not our code** |
| `db:branch` | worktree bootstrap, opt-in | the bootstrap habit — docs-only work needs no database |

Honesty guards, all of which make it under-report rather than over-report:

- **No verdict below 6 decidable branches.** The pruner keeps the population
  small; "50% of 4" is not evidence.
- **Branches under 1h old are excluded** — `cpu_used_sec` lags a fresh branch.
- **Deleted branches are invisible**, so run it *before* a prune.

## What the first run says about the docs-only hypothesis

The hypothesis was that docs-only PRs and worktrees create branches
unnecessarily. The data does not support it as the main cause:

- **Docs-only PRs are 10% of the last 60 merged** (#134, #133, #132, #130,
  #119, #83) — real, but a small slice.
- **The `db:branch` side is well-matched to need.** Every local branch present
  had real compute on it. Bootstrap is not the waste.
- **The waste is preview branches.** Half the current previews were provisioned
  and never queried — and that includes *code* PRs, not just docs ones. Every
  preview deploy gets a database whether the deployment touches one or not.

So the lever Ken is reaching for is the Vercel–Neon integration, not
`scripts/branch-db.ts`. The sample is 4 branches — below the report's own
verdict bar — which is exactly why the check is now a recurring monthly item in
the `neon-branch-prune` task rather than a conclusion drawn today.
