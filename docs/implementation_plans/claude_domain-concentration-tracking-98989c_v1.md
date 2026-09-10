# Domain concentration tracking in the daily user-behavior review — v1

Branch: `claude/domain-concentration-tracking-98989c` · 2026-09-10

## Ask

Ken: add a section to the daily user-behavior review that highlights when
several users from the same company or university domain start to appear
(ignoring consumer providers such as gmail.com), and describe how that
organization is using FGAC.

## What changes

1. **`docs/monitoring.md` §7.20** — four named HogQL queries, all validated
   against production on 2026-09-10:
   - 7.20a sign-up lens: `sign_up_completed` persons rolled up by domain family.
   - 7.20b mailbox lens: `$mcp_tool_call` rolled up by `account_email` domain
     family, with the accessors' own domains beside it.
   - 7.20c per-organization profile: funnel counts plus tool mix, write share,
     delegated share, active days — matched on either lens.
   - 7.20d weekly organizational share of sign-ups.
   Plus the shape table (delegation rollout / team of connectors / stalled
   rollout / cross-domain operator / single power user) that the review uses to
   label each organization.
2. **Scheduled task `fgac-user-behavior-review` (local, `~/.claude/scheduled-tasks/`)**
   — new report section 3.7 DOMAIN CONCENTRATION, an ORG DOMAIN LENSES bullet
   in the event model, a churn-watch carve-out for delegation-only teammates,
   and the 2026-09-10 baseline. This file is outside the repo; the repo doc is
   the durable copy of the queries.

## Design decisions

- **Two lenses, not one.** The organization's name may only appear on the
  mailbox being accessed (a gmail.com operator delegated into company
  mailboxes), so sign-up email alone misses real customers.
- **Domain family key** (`first label, hyphens stripped`) instead of the raw
  domain: one customer spanned three domain variants and read as three small
  domains until grouped. The key is a heuristic and the query returns the
  variant list beside it so the reader can sanity-check.
- **Consumer list lives in the SQL**, extend-only. Universities and schools are
  deliberately not on it.
- **Delegation-only teammates are not churn.** A rollout creates N accounts
  that never connect an agent; counting them as "never called" would inflate
  the disconnect pool the day an organization adopts the product.
- **No automated outreach.** Large rollouts are flagged as a suggestion for
  Ken; nudges stay in-product.

## Validation

All four query shapes were executed against the production PostHog project
through the connector during this session; the family grouping, the
cross-domain attribution and the funnel counts were checked against the
per-domain raw rows. No code, schema or config changed, so no preview deploy
or QA suite applies.
