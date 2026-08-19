# Capability: Magic-Link Approvals (Actionable Denials)

> Phase C of `connector-growth_v1.md`. Send and Sheets denials carry a signed
> deep link that pre-fills the fix; the owning user approves in one click at
> the moment of need. Links are signed, expire (15 min; sheets links 30 min —
> their approval can include a Picker pick + first-time drive.file consent
> round-trip), and require the owning user's session — an agent can mint the
> request, only the human can approve. Consumption is idempotent, not
> single-use (2026-08-19): re-opening a used link whose grant is still active
> is a success ("Already approved"); only a used link whose grant was revoked
> refuses, and never re-grants. Read-block denials deliberately carry NO
> link. Sheets approvals run picker-first when Google lacks a grant for the
> sheet — see capability 17; grant repair is capability 18 (google
> reconnect).

## Assertions

### A1: Send denial includes pre-filled approval links for both scopes
- With no matching whitelist entry, call `gmail_send` to `USER_B_EMAIL`
- **Expected**: Denial text includes TWO approval URLs on the FGAC origin —
  one granting just the denied recipient, one enabling sending to ANY
  recipient on the profile — with the message presenting them as
  alternatives; nothing is sent

### A2: Approving a send link grants exactly the requested recipient
- Open the A1 link in a browser signed in as the owning user; approve
- **Expected**: A confirmation UI naming the recipient and agent before any
  change; after approval, a whitelist rule for that recipient exists (visible
  in `get_my_permissions` and the dashboard), scoped to that profile; the
  agent's retried `gmail_send` succeeds. No other recipients became sendable

### A3: Sheets denial link pre-fills the spreadsheet and offers RO/RW
- Call `sheets_read_range` on an unexposed spreadsheet; open the denial link
  as the owning user
- **Expected**: Approval UI shows the spreadsheet (id and, where resolvable,
  name) with an explicit Read-only vs Read & Write choice. When Google
  already grants the sheet, approval is one click; when it does not, the
  Picker pick comes first (capability 17 A2/A4). After approving Read-only,
  the retried read succeeds and a write still fails

### A4: Used links are idempotent while granted, refused once revoked; links expire
- Reuse the already-approved A2 link; then revoke the granted rule from the
  dashboard and open the same link again; separately, open a link older than
  its expiry window
- **Expected**: While the grant is active, both opening and re-approving the
  used link render "Already approved" (success tone, no button, nothing
  written — idempotent re-use, 2026-08-19 change). After the grant is revoked,
  the used link renders "Link already used" and never re-grants (replaying an
  old link must not resurrect revoked permissions). The expired link is
  rejected with a clear message. The approve page shows these states at page
  LOAD, not after clicking Approve, and `approval_link_opened` records
  status already_granted / used_inactive / expired accordingly

### A5: Another user's session cannot approve
- Open a USER_A denial link in a browser session signed in as USER_B
- **Expected**: Rejected — no rule is created on either account

### A6: Unauthenticated click requires the owner's sign-in
- Open a valid link in a signed-out browser
- **Expected**: Sign-in is required first; after signing in as the owning
  user the approval proceeds (signing in as anyone else hits A5 behavior)

### A7: Tampered links are rejected
- Modify one character of the link's signature or its recipient parameter
- **Expected**: Rejected as invalid; nothing is created

### A8: Read-block denials carry no magic link
- Trigger a label- or content-blocked `gmail_read` denial
- **Expected**: The restriction message contains no approval URL — weakening
  a read block remains a deliberate dashboard act

### A9: Approval URLs are well-formed single-line links
- Capture approval URLs from (a) a send denial, (b) a sheets denial, and
  (c) `request_access`'s structured `approvalUrl` field
- **Expected**: Each URL contains no whitespace or newline characters
  anywhere in the string, and parses to the FGAC origin with path
  `/dashboard/approve` and a non-empty `token` query parameter
- **Regression**: 2026-08-15 tester finding — a trailing newline in the env
  base URL shipped links as `https://fgac.ai\n/dashboard/...`, breaking the
  entire approval loop

### A10: Denial-minted tokens match the access level the operation needs
- Decode the JWT payload (base64url, no verification needed) of the approval
  link from each denied call in this matrix:
  | Denied operation | Sheet state | Required token action |
  |---|---|---|
  | `sheets_read_range` | unexposed | `sheets_expose` |
  | `sheets_update_range` | unexposed | `sheets_write` |
  | `sheets_append_rows` | unexposed | `sheets_write` |
  | `sheets_update_range` | exposed Read Only | `sheets_write` |
  | `google_api_modify` (Sheets PUT) | unexposed | `sheets_write` |
- **Expected**: The token's `action` claim equals the required action in
  every row — a write denial must never mint a read-level (`sheets_expose`)
  token, which would send the user through an approval that cannot satisfy
  the retried operation
- **Regression**: 2026-08-15 tester finding — write denials minted
  `sheets_expose`, creating an approve→retry→fail loop with no signal

### A11: Approving the send-to-anyone link enables all recipients
- From an A1 denial, open the ANY-recipient link signed in as the owning
  user; approve
- **Expected**: The confirmation UI states sending to ANY recipient from
  every mailbox on the profile is being granted; after approval a
  "Send to Anyone" rule (pattern `*`) is assigned to the profile;
  `gmail_send` to arbitrary addresses succeeds; the link is single-use and
  the grant is removable from the dashboard rules
