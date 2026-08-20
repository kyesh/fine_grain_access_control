# Spike: Google Docs API on drive.file per-file grants

**Date**: 2026-08-20 · **Plan**: google-docs-support-plan-b36c1c_v5, Phase 0
**Environment**: dev Clerk instance, USER_A, Cloud project 627660126377

## Part 1 — API mechanics on the drive.file token: PASS

| Probe | Result |
|---|---|
| `POST v1/documents` (create) | 200 — documentId returned; **required enabling the Google Docs API on project 627660126377 first** (was disabled; enabled 2026-08-20 via gcloud, now alongside Sheets + Drive APIs) |
| `GET v1/documents/{id}?fields=title` | 200 — field mask works under drive.file |
| `POST …:batchUpdate` insertText at `endOfSegmentLocation` | 200 — write confirmed in readback |
| `GET v1/documents/{id}` (full) | 200 — raw resource; 5,610 chars for a one-line doc vs 669 chars with `fields=title,body.content` (D7 size baseline) |
| `GET` bogus id | 404 |
| `GET` real doc owned by USER_A, never picked | **404 — grant is per-file, not ambient** (the core FGAC premise holds for Docs) |

## Part 2 — Picker grant registration: mechanism verified by proxy, full-fidelity pick deferred to QA

- Picker opens with `ViewId.DOCUMENTS` + our appId on the app origin; the
  Documents tab renders and lists files.
- Control probe with `ViewId.DOCS` (all types) listed the account's full
  Drive — shared Colabs, Forms, and sheets that are definitely NOT
  app-granted — proving the picker lists ungranted files (listing is
  user-session-scoped, not token-scoped).
- The account owns no *old* Google Docs; docs created during the spike
  (via docs.new and `document/u/0/create?title=…`) had not entered Drive's
  search/listing index within the session (~45 min observed lag on this
  account), so the pick-of-an-ungranted-doc could not be completed live.
- Risk assessment: grant registration by Picker pick is Drive-level and
  file-type-agnostic (drive.file covers "files the user picked with the
  app"); the identical flow with this appId registers sheet grants in
  production daily. Residual docs-specific risk is minimal.
- **Follow-through**: capability 19 A12 executes the full-fidelity docs pick
  (Playwright CDP path) once the fixture doc (`FGAC External Pick Test`,
  created this session) is indexed. QA setup doc now instructs creating
  per-file fixtures ahead of runs because of this lag.

## Incidental findings

1. **Google Docs API was disabled** on the OAuth client's Cloud project —
   enabled during the spike. Launch checklist: verify the PRODUCTION Clerk
   instance's OAuth client project also has docs.googleapis.com enabled
   before/at deploy.
2. **USER_A's dev-instance Google grant had no refresh token** (access token
   expired hourly; Clerk 422 "Cannot refresh OAuth access token"). Cause:
   Clerk's reauthorize leg reached Google with `prompt=select_account`, which
   re-uses the grant without reissuing a refresh token. Repaired by forcing
   `prompt=consent` on the authorization URL (full consent screen → refresh
   token reissued). If USER_A's token dies again mid-QA, re-run the
   reconnect with a forced consent prompt.
3. Brand-new Google Docs (even titled, with the editor open) can take a long
   time to appear in Picker/Drive listings — QA fixtures must be created
   ahead of the runs that pick them.
