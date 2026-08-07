# Reviewer Test Account — Build Runbook & Portal Instructions

Two parts: (1) how WE build the reviewer account before submitting, and (2) the
text to paste into the portal's **Test & launch** step so an Anthropic reviewer
can go end-to-end in ~10 minutes.

> **Public repo notice**: never commit the real reviewer credentials to this
> file. `<REVIEWER_EMAIL>` / `<REVIEWER_PASSWORD>` are placeholders — real
> values go only into the submission portal.

---

## Part 1 — Building the account (us, before submission)

### 1. Create the Google account (human step — not automatable)

- Fresh Gmail account, e.g. `fgac.reviewer@gmail.com` (any available name).
- Password stored in 1Password (vault `FGAC`, item `connector-reviewer`).
- Turn OFF 2-step verification (reviewers can't complete our 2FA), or use an
  account where it's not enforced. No recovery phone tied to personal numbers.

### 2. Populate the inbox (fixtures)

Send the account ~8-10 emails so every demo prompt has something to find:

| Fixture | Purpose |
|---|---|
| 3-4 ordinary emails (meeting notes, a newsletter, a shipping notice) | `gmail_list` / `gmail_read` happy path |
| One email with subject "Your verification code is 482913" | blocked by the content rule (demo denial) |
| One email labeled `Confidential` | blocked by the label blacklist (demo denial) |
| One email with a small PDF attachment (< 100 KB) | `gmail_get_attachment` |
| Gmail labels: create `Confidential` and `AI-Allowed` | label rules reference these |

### 3. Create the spreadsheet fixture

- One Google Sheet named **"Team Budget (Demo)"** owned by the reviewer
  account, two tabs: `Budget` (a small table of categories × months) and
  `Tracking` (a header row for appended entries).

### 4. Configure FGAC (through the dashboard UI, signed in as the reviewer account)

1. Sign in at `https://fgac.ai/dashboard` with Google (this account).
2. Default profile → **+ Expose a sheet** → pick "Team Budget (Demo)" → set
   **Read & Write**.
3. Rules (create on the profile):
   - **Send whitelist**: pattern `fgac-ai@googlegroups.com` (so a reviewer can
     send exactly one place — us; everything else demonstrates the deny).
   - **Content read blacklist**: rule name `Block verification codes`, pattern
     `verification code` (blocks the 2FA fixture).
   - **Label blacklist**: label `Confidential`.
4. The reviewer's connection will auto-attach to the account's **Default
   Profile** (instant-start). Configure the sheet exposure and rules on that
   profile so they govern the reviewer's connection from the first call.

### 5. Dry-run before submitting

Run the whole Part 2 script ourselves from a clean Claude.ai account:
connect → approve → all 5 prompts → confirm outcomes match. Fix any drift
between this doc and reality before submission day.

---

## Part 2 — Paste into the portal's "Test & launch" step

> **Credentials**: Google account `<REVIEWER_EMAIL>` / password
> `<REVIEWER_PASSWORD>` (no 2FA). This account is pre-loaded with email
> fixtures, two Gmail labels, one Google Sheet, and pre-configured FGAC rules.

**Setup (~3 min)**

1. In Claude, add the connector (or as a custom connector:
   `https://fgac.ai/api/mcp`). When the OAuth window opens, choose
   **Sign in with Google** and use the credentials above.
2. Ask Claude: *"List my email accounts."* — Expected: the account list,
   immediately. Signing in attached the agent to the account's read-only
   **Default Profile** — no manual approval step is needed, and the
   dashboard (`https://fgac.ai/dashboard`) shows the new connection with
   review/block controls.

**Functional tests (~7 min)**

| # | Prompt | Expected outcome |
|---|---|---|
| 1 | "Summarize my unread email." | Summaries of the ordinary fixtures. The message whose subject contains a verification code, and the one labeled Confidential, are NOT readable — Claude reports an "Access restricted" notice for them. |
| 2 | "Read the email about my verification code." | Denied: `🚫 Access restricted: Content blocked by rule 'Block verification codes'`. |
| 3 | "Email fgac-ai@googlegroups.com that the review test succeeded." | Sends successfully (that address is whitelisted); Claude returns the Gmail message id. |
| 4 | "Email anyone@example.com hello." | Denied: unauthorized recipient. The denial includes a single-use approval link the account owner could use to whitelist that recipient in one click. Nothing is sent. |
| 5 | "What's in the Budget tab of the Team Budget spreadsheet?" then "Append a row to the Tracking tab: today, 42." | Both succeed (sheet is exposed Read & Write). |
| 6 | "Request permission to send email to demo@example.com." | The `request_access` tool returns an approval link and states nothing is granted until the user approves. A follow-up send to that address still fails (the link was not approved). |

**Notes for the reviewer**

- Read-only tools carry `readOnlyHint`; write tools carry `destructiveHint`.
- `google_api_get` / `google_api_modify` accept freeform Gmail/Sheets API
  paths; try `google_api_get` with `drive/v3/files` to see the deny-by-default
  behavior (unsupported APIs are refused server-side).
- Public docs: `https://fgac.ai/docs` · Privacy: `https://fgac.ai/privacy`
- Support / questions: `fgac-ai@googlegroups.com`
