# Approval-funnel nudges — v3: idempotent link re-use

Adds to v2, per Ken's direction (2026-08-19): clicking a used approval link
must never dead-end. Evidence: the week's only rage-clicker rage-clicked
/dashboard/approve 19–33s AFTER a successful approval — she had two sibling
links minted a minute apart and hit the hard single-use wall on the second.

Semantics now:
- Used link, grant still active → "✓ Already approved" success card, rendered
  at page LOAD (approvalLinkStatus pre-flight) and on re-approve (idempotent —
  nothing written). approval_link_opened status: already_granted.
- Used link, grant revoked/never written → clear "Link already used" refusal
  with recovery copy; NEVER re-grants (replaying old links must not resurrect
  revoked permissions — the one real security property of single-use, kept).
  Status: used_inactive.
- TTL expiry unchanged (15/30 min). Double-submit race fixed with a
  pending-aware ApproveSubmitButton (the race also produced error-after-
  success).

Grant-activity check (grantActiveForApproval) mirrors the approve writers
exactly: send_whitelist `^escaped$` or `*` patterns, send_all `*`, sheets
targetResourceId + actionType, each global-or-assigned-to-key.

Verified live (local, real UI): approve → re-open = Already approved; delete
rule via dashboard → re-open = refusal, nothing re-granted. QA capability 14
A4 rewritten to the new semantics.
