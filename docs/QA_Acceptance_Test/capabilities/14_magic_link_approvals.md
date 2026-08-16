# Capability: Magic-Link Approvals (Actionable Denials)

> Phase C of `connector-growth_v1.md`. Send and Sheets denials carry a signed
> deep link that pre-fills the fix; the owning user approves in one click at
> the moment of need. Links are signed, single-use, expire (~15 min), and
> require the owning user's session — an agent can mint the request, only the
> human can approve. Read-block denials deliberately carry NO link.

## Assertions

### A1: Send denial includes a pre-filled approval link
- With no matching whitelist entry, call `gmail_send` to `USER_B_EMAIL`
- **Expected**: Denial text includes an approval URL on the FGAC origin
  whose parameters identify the recipient and the connection/profile;
  nothing is sent

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
  name) with an explicit Read-only vs Read & Write choice; choosing Read-only
  exposes it; the retried read succeeds and a write still fails

### A4: Links are single-use and expire
- Reuse the already-approved A2 link; separately, open a link older than its
  expiry window
- **Expected**: Both are rejected with a clear message and change nothing

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
