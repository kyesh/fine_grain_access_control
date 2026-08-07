# Capability: Default Profile & Instant Start

> Phase B of `connector-growth_v1.md`. A brand-new user's journey is:
> click connector → Google OAuth → first tool call succeeds. No dashboard
> visit required. The Default profile is Gmail read-only (no send whitelist,
> no Sheets exposures) with the sensitive-mail shield OFF by default
> (decision log, 2026-08-06).

## Assertions

### A1: Fresh Google account connects and works immediately
- Using a Google account with NO existing FGAC user, complete the MCP OAuth
  flow, then call `list_accounts` without ever visiting the dashboard
- **Expected**: FGAC user + Default profile auto-created; the tool returns the
  account's own email; no pending-approval message at any point

### A2: Default posture allows reading mail
- On the fresh connection, call `gmail_list` then `gmail_read` on a result
- **Expected**: Both succeed against the user's own inbox

### A3: Default posture denies sending
- Call `gmail_send` to any address (e.g. `USER_B_EMAIL`)
- **Expected**: Denied with the no-send-whitelist message; Gmail Sent folder
  confirms nothing was sent

### A4: Default posture denies Sheets
- Call `sheets_read_range` with any spreadsheet id the user owns
- **Expected**: Denied — spreadsheet not exposed in FGAC rules

### A5: Shield is OFF by default (explicit decision test)
- Fixture: an inbox message whose body contains "verification code 482913".
  On the fresh default profile, `gmail_read` that message; then call
  `get_my_permissions`
- **Expected**: The message IS readable (no shield rules exist), and
  `get_my_permissions` lists no content-block rules — confirming the
  documented default, not silently-enabled shield rules

### A6: OAuth landing page shows onboarding state
- Complete the OAuth flow in a browser and inspect the post-consent page
- **Expected**: States the agent is connected; summarizes the posture (can
  read mail; cannot send, edit, or delete); the top CTA is one-click
  "enable sensitive-mail shield"; links to dashboard upgrades

### A7: One-click shield enable works and takes effect
- Click the shield CTA on the landing page (or its dashboard equivalent),
  then re-read the A5 fixture message via MCP
- **Expected**: Shield rules now appear in `get_my_permissions`, and the
  fixture read is denied with a rule-named restriction message

### A8: User is notified of the new connection
- After A1, sign in to the dashboard
- **Expected**: A visible notice that a new agent connected with safe
  defaults (banner or equivalent), showing the client name and its profile,
  with review/block controls one click away

### A9: Second client also auto-attaches
- Register a second DCR client, OAuth as the same user, call a read tool
- **Expected**: Works immediately; dashboard shows both connections on the
  Default profile as distinct entries

### A10: Delegated inboxes are never auto-granted
- On the fresh connection, call `gmail_list` with `account=USER_B_EMAIL`
  (no active delegation from USER_B)
- **Expected**: Denied — auto-attach grants access only to the OAuth-ed
  user's own mailbox; delegation still requires the owner's explicit action
  (capability 04 flow)

### A11: Auto-attached connections can still be blocked
- Block the A1 connection from the dashboard, then retry a read tool
- **Expected**: "🚫 This connection has been blocked by the user." — one-click
  block is unchanged by instant-start
