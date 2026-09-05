# Google sign-in narrows the Clerk grant — v2 (after the dev-instance measurements)

Branch: `claude/dazzling-driscoll-46d685`, PR #118. Supersedes v1 once the open
question was measured (2026-09-04, dev Clerk, USER_A / USER_B, QA runner in the
built-in browser; Clerk API probes before and after every step).

## What was measured

| step | result |
|---|---|
| Plain "Continue with Google" sign-in | Request: `prompt=select_account`, scope = base + gmail.modify, no `include_granted_scopes`. Google shows only the account chooser. Clerk rewrites `approved_scopes` AND the served access token to that set — drive.file gone from tokeninfo within 20 s. Reproduced on both accounts. |
| Google-side grant after the narrowing | myaccount.google.com/connections still lists Drive per-file access for the app. Google never revoked anything. |
| Narrowed grant, ~1 h later (USER_A) | Clerk refreshed the expired token and the NEW token carries drive.file again (tokeninfo), while `approved_scopes` still says it is missing. The sign-in returned no refresh token, so Clerk kept the older, wider one. |
| Reauthorize for drive.file with no consent prompt (USER_B) | Clerk's default `prompt=select_account`; Google shows a one-account chooser, no consent screen; drive.file back in Clerk + tokeninfo; status verified. |
| That grant, ~1 h later | Refreshed cleanly, token carries drive.file. The no-consent pass did not leave a refresh-less grant. |
| Consent reconnect for comparison (USER_B, Accounts button) | Three Google screens (unverified-app warning, "signing back in", "additional access" — no checkboxes for a single incremental scope). |

Production, `npm run google:scope-sweep -- --prod --tokens` (read-only, counts
only, prod env file deleted afterwards):

| Clerk record lacks drive.file (136) | token HAS drive.file | token lacks it | unrefreshable |
|---|---|---|---|
| with Sheets/Docs rules (6) | **4** | 2 | 0 |
| without (130) | 4 | 118 | 8 |

## Corrected diagnosis

A sign-in causes a **one-hour outage** (narrow access token) plus a
**permanently stale Clerk scope record**. The MCP pre-flight enforced on the
record alone, so the 8 accounts above — including 4 of the 6 Sheets/Docs users,
the owner's two among them — were denied Sheets/Docs indefinitely although their
token was fine. That, not the hour, is the population behind the trailing-14-day
`google_scope_missing / drive_file` count (63 calls, 33 users). The 2 truly
broken Sheets/Docs users have a narrow refresh token and need a consent pass.

## Decisions

1. **Tokeninfo-confirmed MCP pre-flight** (v1 change 1) is the headline fix: it
   unlocks the stale-record accounts on their next call, no user action.
   `clerk_scope_cache_stale` on `$mcp_tool_call` counts them.
2. **Post-sign-in auto-repair uses `select_account`**, not `consent`
   (`AUTO_REPAIR_PROMPT`). For the population it targets (Sheets/Docs users
   whose sign-in just narrowed the token) Google already holds the scope, so it
   is a one-chooser-click bounce with no consent screen and the grant survives
   expiry (measured). If Google does not hold the scope, `select_account` still
   shows consent; if that pass returns incomplete, the Accounts page's manual
   button runs the full `consent` leg as before.
3. **Card and MCP message** say the permission normally returns on its own within
   an hour after a sign-in — true for the retained-refresh-token case, and the
   auto-repair makes it immediate for dashboard users.
4. **Picker/approve-link reconnect stays on `consent`.** Same silent bounce would
   cut the approve-link detour from three screens to one click for users Google
   already knows, but the first-time-drive.file case (whether a consent shown
   under `select_account` returns a refresh token) was not measured. Follow-up
   experiment, not this PR.
5. **Clerk dashboard sign-in scope set unchanged** (v1 rejection stands).

## QA

Capability 18 assertions A9 (auto-repair, chooser-only), A10 (card copy), A11
(pre-flight trusts the token). Run locally and on the PR preview (the preview
serves the dev Clerk instance, so account state is shared with local — run
sequentially). USER_A holds a Sheets rule and is currently narrowed by a sign-in
with a wide refresh token: it is the A9/A11 fixture.
