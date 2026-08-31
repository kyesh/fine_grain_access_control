# Raw Google API error follow-through: bare Drive spellings, comments error quality — v1

Branch: `claude/recursing-mendeleev-8ec525` · Date: 2026-08-31

## Why this plan looks nothing like the task brief

The brief was written against the **deployed production build**, not current `main`.
Every headline gap it names already landed:

| Brief's gap | Already fixed by | Landed |
| --- | --- | --- |
| 403 branch emits generic unbound `/dashboard/accounts` URL | `reconnectLink()` is account-bound (`?reconnect=1&for=<email>`), used by 401/403/scope denials | 715aad7 (PR #105, 2026-08-30) |
| 403 can't name drive.file as the missing scope | `driveFileScopeDenial()` pre-flight on every non-Gmail raw call and typed sheets/docs/comments tool, names drive.file explicitly | bbc51ff + eb3db88 (PR #97, 2026-08-29) |
| 404 "Check the ID and try again" on drive.file-invisible files | `passthroughErrorResult()` (drive/slides passthrough), `fileGrantErrorResult()` (per-file sheets/docs), `gmailNotFoundResult()` (gmail ids) | bbc51ff, 1f437f2 |
| `people:createContact` escapes the family pre-flight | classifier checks the verb-stripped base of the first TWO segments — both `people/v1/…` and `v1/people:createContact` spellings deny pre-flight (unit-tested) | bbc51ff |

PostHog confirms the timing story (queries run 2026-08-31, project 343912, external users):

- All `error_reason: null` Google-error rows stop at 08-29; from 08-30 the
  "continuing errors" are dominated by `outcome='failed'` rows with
  `failure_reason: drive_file_scope_missing` / `google_token_unavailable` —
  i.e. the new pre-flights firing deterministically instead of Google 403s.
  **That is the fix working, not the bug persisting.**
- The `people:createContact` 404s (both spellings) are from 08-24 —
  pre-deploy. Zero `raw_api_family_unsupported` rows since means no repeat
  demand, not a pre-flight miss.
- The 13 creation-endpoint 403s all predate reason-stamping, so a per-cause
  split is unrecoverable for them; but the users who hit them also 403'd on
  per-file *reads* (scope-level failure signature), and the same population
  now trips `drive_file_scope_missing` pre-flights — consistent with the
  missing-drive.file mechanism, now handled before Google is called.
- Production is running a build from the 08-29→08-30 window: pre-flights and
  reason-stamping are live; PR #105's bound reconnect links and the 08-30
  gmail allow-by-default are **merged but not yet deployed** (user action:
  `/deploy-prod`).

## What is actually still broken on main (evidence-backed)

**Gap 1 — bare Drive spellings misroute and produce a false diagnosis.**
2026-08-31 04:19Z: a user called `v3/files/{id}/comments` (GET + POST, no
`drive/` prefix). The classifier doesn't recognize the spelling → `passthrough`
family `v3/files` → routed to `www.googleapis.com/v3/…`, which serves nothing →
bare routing 404 → `passthroughErrorResult` told the agent *the file may be
invisible to this token* (wrong — the URL was). The agent recovered only by
guessing the `drive/` prefix a minute later (which worked, first try, and also
skipped per-file comments enforcement classification in the failed attempts).
This is the exact misroute-then-respell loop PR #97 fixed for Slides'
`v1/presentations`; Sheets (`v4/spreadsheets`) and Docs (`v1/documents`) accept
their bare spellings — Drive is the remaining family that doesn't.

**Gap 2 — comments calls that pass FGAC policy but fail at Google get the
generic error.** The raw `file_comments` executor branch and the typed
`comments_read`/`comments_add` tools return bare `errorResult(result.error)`.
A 403/404 there — after the FGAC rule check passed — is the classic
approved-by-link-but-never-Picker-granted state that `fileGrantErrorResult`
exists for; comments should get the same setup-link answer.

**Gap 3 — the generic 404 text still says "Check the ID and try again."**
Post-#97, this branch is only reachable from raw gmail calls and as the prefix
of `passthroughErrorResult`'s composed message — which then contradicts it
("try again" + "do NOT retry the same id"). Reword to make blind retry the
non-default.

## Changes

1. `src/app/api/mcp/googleApiPolicy.ts`
   - `canonicalizeGoogleApiPath()`: `v2|v3` + Drive top collection
     (`files|drives|about|changes`) at path start → prepend `drive/`.
     Idempotent; leaves every other family untouched.
   - `classifyGoogleApiCall()` and `templateGoogleApiPath()` canonicalize
     internally, so classification, per-file comments enforcement, and the
     `raw_api_endpoint` analytics template converge on one spelling.
2. `src/app/api/mcp/route.ts`
   - `google_api_get` / `google_api_modify` handlers canonicalize the caller
     path once up front, so host routing uses the canonical spelling too.
   - Raw `file_comments` + `comments_read` failures → `fileGrantErrorResult`;
     `comments_add` → `commentsErrorResult` (same, plus the stale-`commentId`
     second cause when replying).
   - Generic 404 copy: id is wrong/stale/not visible; verify against a fresh
     listing; same id unchanged will 404 again.
3. `scripts/test-google-api-policy.ts`: canonicalization unit cases (bare →
   canonical, idempotence, query-string, non-Drive untouched, segment
   boundary), bare-spelling classification (`file_comments`, passthrough
   family), endpoint template.
4. Docs: capability 10 note for the accepted bare Drive spelling.

## Rejected on evidence

- Extra scope-state plumbing into `describeGoogleError` (brief's direction a):
  the known-missing case never reaches Google anymore (pre-flight), and the
  unknown case already gets reason-coded 403 branching with a bound link.
- Any `people`/pre-flight change (direction c): resolved as deploy lag.
- Retuning the 403 branch (direction a): landed in 1f437f2/715aad7.
