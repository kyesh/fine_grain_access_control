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

- ✅ DONE (2026-08-16): a dedicated reviewer Gmail account exists. Its
  address, password, and 2FA live in 1Password (vault `FGAC`, item
  `connector-reviewer`) — referenced here only as `<REVIEWER_EMAIL>`,
  `<REVIEWER_PASSWORD>`, `<1PASSWORD_2FA_LINK>`.
- The account HAS 2-step verification; reviewers get codes via a 1Password
  shared link included in the portal submission. **The password and the
  1Password share link are secrets — the share link mints live 2FA codes.
  Neither may ever appear in this repo, an issue/PR, or any committed doc.**

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
   - **Send whitelist**: pattern `support@fgac.ai` (so a reviewer can
     send exactly one place — us; everything else demonstrates the deny).
   - **Content read blacklist**: rule name `Block verification codes`, pattern
     `verification code` (blocks the 2FA fixture).
   - **Label blacklist**: label `Confidential`.
4. The reviewer's connection will auto-attach to the account's **Default
   Profile** (instant-start). Configure the sheet exposure and rules on that
   profile so they govern the reviewer's connection from the first call.

### 5. Dry-run before submitting

Run the whole Part 2 script ourselves from a clean Claude.ai account:
connect → all 6 prompts → confirm outcomes match. Fix any drift between this
doc and reality before submission day.

---

## Part 2 — Portal "Test & launch" instructions

**Submitted version (2026-08-16)** — this is the text that went into the
portal, with secrets as placeholders (real values in the portal + 1Password
only; never commit them):

> **Step 1: Log in to google.com**
> User Name: `<REVIEWER_EMAIL>`
> Password: `<REVIEWER_PASSWORD>`
> 1Password link for 2FA code: `<1PASSWORD_2FA_LINK>`
>
> **Step 2: Log in to FGAC.ai using Google OAuth**
> Visit https://fgac.ai/ and click Sign up. Select "Continue with Google"
> and use the `<REVIEWER_EMAIL>` account. This logs you in with Google OAuth.
>
> **Step 3: Connect Claude**
> Add the connector `https://fgac.ai/api/mcp` in Claude. Approve the
> connector in the FGAC.ai OAuth flow.
>
> The MCP is ready to use immediately — signing in attaches the agent to the
> account's read-only Default Profile; no manual approval step.

**Suggested functional script** (richer optional addition for the same portal
field — gives reviewers expected outcomes per prompt):

**Functional tests (~7 min)**

| # | Prompt | Expected outcome |
|---|---|---|
| 1 | "Summarize my unread email." | Summaries of the ordinary fixtures. The message whose subject contains a verification code, and the one labeled Confidential, are NOT readable — Claude reports an "Access restricted" notice for them. |
| 2 | "Read the email about my verification code." | Denied: `🚫 Access restricted: Content blocked by rule 'Block verification codes'`. |
| 3 | "Email support@fgac.ai that the review test succeeded." | Sends successfully (that address is whitelisted); Claude returns the Gmail message id. |
| 4 | "Email anyone@example.com hello." | Denied: unauthorized recipient. The denial includes a single-use approval link the account owner could use to whitelist that recipient in one click. Nothing is sent. |
| 5 | "What's in the Budget tab of the Team Budget spreadsheet?" then "Append a row to the Tracking tab: today, 42." | Both succeed (sheet is exposed Read & Write). |
| 6 | "Request permission to send email to demo@example.com." | The `request_access` tool returns an approval link and states nothing is granted until the user approves. A follow-up send to that address still fails (the link was not approved). |

**Notes for the reviewer**

- Read-only tools carry `readOnlyHint`; write tools carry `destructiveHint`.
- `google_api_get` / `google_api_modify` accept freeform Gmail/Sheets API
  paths; try `google_api_get` with `drive/v3/files` to see the deny-by-default
  behavior (unsupported APIs are refused server-side).
- Public docs: `https://fgac.ai/docs` · Privacy: `https://fgac.ai/privacy`
- Support / questions: `support@fgac.ai`
