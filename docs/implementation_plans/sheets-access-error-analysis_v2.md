# Sheets Grant Recovery — Implementation Plan v2 (picker-first approvals)

Supersedes v1's approve→discover→recover sequencing for magic-link approvals.
v1 shipped: grant verification, `/dashboard/sheets-setup` recovery page
(picker + demo video), dashboard "Needs Google access" chips, honest MCP
stranded-sheet errors, `sheets_grant_*` analytics. All validated end-to-end
locally (denial → approve → recover → pick → verified → MCP success).

## What changes in v2

v1 still let the user approve a rule for a sheet we could not reach — the
recovery page caught it afterwards. v2 moves the pick BEFORE the approval
when verification says the grant is missing, because the pick is the real
authorization moment: it registers the Google grant AND confirms the file's
identity (title + true id). Consequences:

1. **Approve page becomes a small state machine** (client component
   `SheetsApprovalFlow` for sheets tokens; non-sheets tokens unchanged):
   - `checking`: on load, `verify-sheets-access?sid=…&context=link_open`
     (fires `sheets_grant_verification {via: link_open}`).
   - `ok` → straight RO/RW confirm (today's one-click path).
   - `missing` → **Step 1: pick the sheet** — picker button + demo video,
     NO approve button yet. After the pick:
     - picked includes the token's id → RO/RW confirm for it;
     - picked ≠ token id → explicit **substitution** confirm: grant what
       was picked, never the unverifiable id.
   - `unknown` (Google hiccup) → degrade to the v1 flow (approve, server
     fallback still routes to /dashboard/sheets-setup if needed).
2. **No phantom rules.** Server-side, substituted grants are created only
   for picked ids that verify `ok` with the owner's token — the client
   cannot smuggle in an arbitrary id. The token's id gets NO rule unless it
   verifies. `approveMagicLink(token, rw, pickedSheets?)` implements this;
   token consumption (jti) stays at final confirm, so picking and
   abandoning does not burn the link.
3. **Token lifetime**: sheets approval links get 30 min (others stay 15) —
   the pick plus a first-time drive.file consent round-trip can exceed 15.
   Denial messages state the right number.
4. **Consent round-trip keeps the token**: `useGooglePicker` now preserves
   the page's existing query params in the OAuth redirect and its cleanup,
   so the approve page's `token` survives the drive.file consent leg.
5. **Recovery page stays** for dashboard chips + MCP error deep links
   (pre-existing stranded rules); picker-first stops new ones being minted.

## Agent-side story for substitution

The agent asked for id X; the user granted picked sheet Y. The agent's
retry on X gets the honest stranded-sheet error; `get_my_permissions` now
lists Y with its id (capability 09 A5), so the agent self-corrects.
`approval_link_approved` carries `substituted: true` + `granted_count` so
wrong-id frequency is measurable.

## QA capability 17 updates

A2 asserts the picker-first state (approve button absent while the grant is
missing); A4 asserts pick→confirm→approve ordering; new A9 covers
substitution (different file picked → rule for picked id only, none for the
requested id, server rejects unverified substitutes). A5 (grant already
ok → straight confirm) unchanged in spirit. Agent runbooks updated.
