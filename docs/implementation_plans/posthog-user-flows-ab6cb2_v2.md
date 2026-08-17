# v2 — Signup-Source Attribution (connector flow vs website)

Extends v1 (delegation observability). New problem: FGAC joined the Claude Connector
Directory 2026-08-16T17:00Z and sign-ups surged, but connector-flow users authenticate
on **Clerk's hosted OAuth pages** — they can create an account without ever loading an
fgac.ai page, so referrer/UTM/`sign_up_started` never fire for them and acquisition
channel was unmeasurable.

## Design

`signup_source` person property (`claude_connector` | `website`), stamped **$set_once**
so the first touchpoint wins and it can never flip later:

- **`src/app/api/mcp/route.ts`** — `mcp_connection_created` now carries
  `account_age_seconds` (event time − `users.createdAt`). When the account is <10 min
  old, the capture also stamps `$set_once: {signup_source: 'claude_connector'}` —
  connector sign-ups hit their first MCP request within seconds of account creation.
- **`src/app/PostHogIdentify.tsx`** — client identify passes
  `$set_once: {signup_source: 'website'}` only when Clerk's `user.createdAt` is <10 min
  old. The freshness guard keeps pre-existing accounts from being mislabeled on their
  next dashboard visit.

Race resolution: connector users' server stamp lands seconds after signup, before any
dashboard visit; website users identify on their post-signup dashboard load, before any
connector setup. `$set_once` makes the ordering decisive.

## Retroactive classification (pre-deploy data)

Signed-up person with an `mcp_connection_created` and no earlier `$pageview` ⇒
connector-first; earliest `$pageview` at/before first connection ⇒ website-first.
Validated on the launch cohort: 43 sign-ups → 36 connector-first, 6 website-first,
1 unclassified. The daily-review routine uses `signup_source` where present and this
heuristic for older persons.

## Validation

`npx tsc --noEmit` clean. No schema changes.
