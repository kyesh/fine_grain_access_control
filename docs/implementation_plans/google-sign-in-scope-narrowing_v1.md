# Google sign-in narrows the Clerk grant (drive.file lost on every sign-in)

Branch: `claude/dazzling-driscoll-46d685`. Investigation started 2026-09-04 from the
owner's two accounts showing "Action Required: Connect Google Account".

## Mechanism (verified in code and production data)

- Clerk keeps one Google external account per user and rewrites its
  `approved_scopes` (and stored tokens) with the scope set of whichever OAuth
  request last completed. A plain Google sign-in requests only the scope set
  configured on the Clerk dashboard's Google connection — `openid email profile`
  plus `gmail.modify` — never `drive.file`.
- `drive.file` is only ever requested by the repair paths (`startGoogleReconnect`
  from the Picker, the Accounts page button, and the dashboard card).
- So a user who granted `drive.file` through the Picker loses it from Clerk's
  record the next time they sign in with Google. Every Sheets/Docs call then fails
  the drive.file pre-flight.

Production sweep (`npm run google:scope-sweep -- --prod`, read-only, counts only,
2026-09-04):

| | accounts | grant last written at the user's last sign-in | have Sheets/Docs rules |
|---|---|---|---|
| WITH drive.file | 77 | **0** | 58 |
| WITHOUT drive.file | 136 | 75 | **6** (4 of them written at sign-in) |

Scope sets on grants last written at sign-in: `base + gmail.modify` (41) and
`base` only (34) — never drive.file. PostHog (trailing 14 days): the MCP
drive.file pre-flight denial hit 63 calls from 33 distinct users;
`sheets_grant_verification` result `missing` at link open: 87 events / 32 users.

## Open question being measured (QA runner, dev Clerk, USER_A / USER_B)

1. Does the Google-side grant keep drive.file after a narrowing sign-in?
2. After the narrowed access token expires (~1 h), does Clerk's refresh yield a
   token with drive.file again (i.e. did Clerk keep the old refresh token)?
3. Does a reauthorize with `additionalScopes: [drive.file]` and no consent prompt
   bounce back without UI, and does the resulting grant survive expiry?

The answer picks the auto-repair prompt (`AUTO_REPAIR_PROMPT` in
`ConnectGoogleWarning.tsx`): `consent` is the measured-safe default (Google only
returns a refresh token on a consent pass); anything quieter is adopted only if
(3) survives expiry.

## Changes in this revision

1. **Readers agree** — `src/lib/googleTokenScopes.ts`: cached tokeninfo lookup.
   The MCP pre-flight (`getGoogleToken` in `src/app/api/mcp/route.ts`) consults
   it before denying on Clerk metadata; a corrected denial stamps
   `clerk_scope_cache_stale` on `$mcp_tool_call`. The dashboard and Picker bridge
   already used tokeninfo.
2. **Card names the missing scope** — `src/lib/googleScopeCopy.ts` decision table
   (unit-tested in `scripts/test-google-scope-copy.ts`, part of `mcp:lint`);
   `ConnectGoogleWarning` renders it. The MCP denial message names the sign-in
   reset as the likely cause.
3. **Post-sign-in auto-repair** — `ConnectGoogleWarning` starts the reconnect on
   its own for users with Sheets/Docs rules who arrive from a sign-in without
   drive.file (Gmail present, verified account, once per sign-in, never on an
   OAuth return leg). Returns to `/dashboard/accounts?reconnected=1` so the
   existing tokeninfo verification closes the funnel
   (`google_reconnect_started {source: 'sign_in_auto'}`).
4. **Measurable** — `sign_in_completed` client event
   (`SignInTelemetry.tsx`, once per Clerk `lastSignInAt`) with
   `gmail_scope`, `drive_file_scope`, `needs_drive_file`, `drive_file_narrowed`.
5. **Sweep script** — `scripts/google-scope-sweep.ts` (`npm run google:scope-sweep`),
   read-only, counts only, `--prod` reads `.secrets/prod.env`.

## Rejected / deferred

- **Adding drive.file to the Clerk dashboard sign-in scope set.** It would keep
  the 77 wide grants wide, but Google re-prompts for any requested-but-ungranted
  scope on every sign-in, so the 136 users without drive.file (most without any
  Sheets/Docs rules) would see a Drive consent screen at each sign-in until they
  grant it — the opposite of the least-privilege positioning. Not done here; a
  Clerk-dashboard change is a user action anyway. Re-evaluate if the auto-repair
  funnel shows users abandoning the extra consent screen.
- **`include_granted_scopes=true`** — not exposed by Clerk's Google connection or
  `reauthorize()`.

## QA

Local + preview: sheets/picker capabilities in `docs/QA_Acceptance_Test`, plus the
targeted scenario: user with a Sheets rule signs in with Google → lands on the
dashboard → is taken through one consent screen → Accounts page shows both scopes
verified → MCP `sheets_read_range` succeeds without a reconnect link.
