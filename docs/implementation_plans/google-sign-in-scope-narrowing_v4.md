# Google sign-in narrows the Clerk grant — v4 (drive.file added to the sign-in scope set)

Branch: `claude/dazzling-driscoll-46d685`, PR #118. Supersedes the v1/v2 rejection
of the Clerk-dashboard change.

## What changed

On 2026-09-04 the owner added `https://www.googleapis.com/auth/drive.file` to the
Google social connection's scope list on the **dev** Clerk instance ("Use custom
credentials" → scopes). Every sign-in now requests drive.file alongside
gmail.modify, so Clerk's record is written wide whenever Google already holds the
grant.

Measured the same day (QA runner, Path B Chrome, dev Clerk, Clerk API probes
before and after):

| account | before | Google request | Google screens | after |
|---|---|---|---|---|
| USER_B (record narrow, Google holds grant, no rules) | record + token lack drive.file | `scope` = base + gmail.modify + drive.file, `prompt=select_account` | account chooser only — no consent, no unverified-app warning | record + token both carry drive.file; no card; badges both green |
| USER_A (already wide, has a Sheets rule) | wide | same | chooser only | still wide; 20 s on the dashboard with no auto-repair redirect; no card |

PostHog: `sign_in_completed` with `drive_file_scope = true`, `drive_file_narrowed
= false` for both; zero `google_reconnect_started`.

## Why the earlier rejection was wrong

v1/v2 assumed Google would re-prompt every sign-in for users without the scope.
It re-prompts only users who *decline*: a user who never granted drive.file sees
one incremental "wants additional access" screen (single Continue, no checkboxes)
at their next sign-in, and never again once accepted — and that consent pass
issues a fresh refresh token, which also repairs the two production accounts
whose refresh token is narrow. Only a user who cancels is asked again.

## What the branch's changes become

- Tokeninfo-confirmed MCP pre-flight: still needed until every stale-record
  account signs in again; harmless afterwards.
- Scope-naming card + `sign_in_completed` telemetry: unchanged, still useful
  (decliners, revoked grants).
- Post-sign-in auto-repair (`select_account`): a safety net that no longer fires
  on this instance; it still covers a record narrowed any other way.
- The sweep (`--tokens`) is the way to watch the production population converge
  after the same dashboard change is made there.

## Remaining

1. **Production Clerk dashboard**: add the same scope (user action; instances are
   configured separately). Then re-run `npm run google:scope-sweep -- --prod
   --tokens` over the following days: "WITHOUT drive.file, written at sign-in"
   should trend to zero.
2. Post-expiry probes of both QA accounts after these sign-ins (USER_B's refresh
   token was narrow before) — result appended below when available.
3. QA capability 18 A9 now needs its fixture arranged explicitly (a record
   narrowed by something other than a sign-in), see the assertion note.
