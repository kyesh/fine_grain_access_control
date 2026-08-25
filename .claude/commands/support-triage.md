---
description: Triage a support email end-to-end — acknowledge fast, verify every claim against production (read-only), classify user-deviation vs product bug, fix and remediate proactively, scan for silently-affected users, and draft the reply in Ken's voice for approval
---

# Support Triage

Handle an inbound support email the way the 2026-08-24 "Token Lookup Problem"
case was handled (see
`docs/bug_reports/identity_email_drift_breaks_token_lookup.md` for how that
one resolved). The support mailbox is **ken@fgac.ai** (support@fgac.ai
forwards into it), delegated to Ken's account and readable through the
**production** FGAC MCP connector (`gmail_list` / `gmail_read` with
`account: 'ken@fgac.ai'`; full threads via `google_api_get`
`gmail/v1/users/me/threads/{id}`).

**Hard rules, before anything else:**

- **Never send email.** Every reply is a draft Ken reviews. Place approved
  copy as a Gmail draft only when Ken asks.
- **Production access is read-only.** SELECTs and GET-only API calls. Pull
  creds with `npx vercel env pull .secrets/prod.env --environment=production`,
  run scripts from inside `.secrets/` (gitignored, and module resolution
  works there), and `rm .secrets/prod.env` plus any scripts when done.
- **Public-repo rules apply** to everything that reaches GitHub: no customer
  emails, Clerk ids, proxy keys, or verbatim DB rows in commits, PRs, or
  issues. Placeholders only.
- Account-level remediation (fixing a user's data/settings) is Ken's call —
  propose it with the exact change; don't execute writes yourself.

## 1. Acknowledge first, investigate second

Send-day acknowledgment matters more than a complete answer. Draft a short
triage reply for Ken that:

- asks the clarifying question that splits the hypothesis space (e.g. "are
  you trying to delegate from one account to another, or are these two
  separate issues?");
- asks how their flow deviated from the documented setup, linking the
  relevant self-serve pages — prefer the fgac.ai use-case pages (they embed
  the videos): https://fgac.ai/use-cases/google-sheets-agent and
  https://fgac.ai/use-cases/multiple-gmail-accounts, plus
  https://fgac.ai/setup;
- commits to a deadline: "Let me investigate and I'll get back to you with
  an update later today."

## 2. Verify every claim before believing any of them

User reports describe *symptoms accurately* and *causes wrongly* — the UI
they're reading may itself be the bug. Reconstruct the ground truth:

1. **Repo**: find the exact error string they quote (`grep -rn "<message>"
   src/`) and read the code path that emits it. Note what the code keys on.
2. **Production DB** (read-only): pull the user's `users` row, `proxy_keys`,
   `key_email_access` (own rows have `delegation_id IS NULL`), and
   `email_delegations`. Compare every email address field.
3. **Clerk** (read-only, `CLERK_SECRET_KEY` from prod env — verify it's
   `sk_live_`): `GET /v1/users/{clerk_user_id}`. The forensic gold is in
   `email_addresses[].verification.strategy` (`email_code` = typed in by
   hand; `from_oauth_google` = arrived via OAuth) and `linked_to`, plus
   `external_accounts[]` (`created_at`/`updated_at` show whether reconnects
   actually succeeded). This is how you distinguish "connected the wrong
   Google account" from "our bookkeeping drifted."
4. **PostHog**: cross-reference `$mcp_tool_call`/`mcp_tool_call` outcomes,
   `google_token_fetch_failed`, `google_token_identity_fallback`, and
   `proxy_request` for their `account_email` / person email. Establish when
   failures started and what they tried.

Build a timeline before writing conclusions. If the evidence contradicts the
user's framing (or your first theory), say so plainly in the internal
write-up — the classic trap in the reference case: the Accounts page
*displayed* the identity email labeled as the connected Google account, so
the user's "wrong account connected" report was a faithful reading of a
lying UI.

## 3. Classify honestly

State two things separately, without flattery and without blame:

- **What the user did off-script**, with evidence and timestamps ("on Aug N,
  X was added via the profile menu — that step isn't part of any documented
  flow"). Never write "you did everything right" unless the data shows it.
- **What our system did wrong** in response — the bug is usually that we
  mishandled the off-script step, displayed something misleading, or emitted
  an error that pointed away from the cause.

## 4. Fix, remediate, and prevent

- **Code fix** through the normal flow: branch off latest main, implementation
  plan in `docs/implementation_plans/`, bug report in `docs/bug_reports/`,
  PR + `/deploy-pr-preview`; Ken runs `/deploy-prod`.
- **Prefer self-healing fixes**: make the deployed code tolerate the broken
  state (fallbacks) AND converge it back to correct on next contact, so
  affected users need zero manual steps.
- **Propose account remediation for Ken to execute** (e.g. remove a stray
  profile email in Clerk, toggle an instance setting that closes the trap
  door). Doing it *for* the user beats sending them instructions.
- **Close the entry point**: if a settings/config change prevents recurrence
  (Clerk dashboard options, guard rails in the UI, better copy near the
  decoy control), name it explicitly as a Ken action item.

## 5. Scan for silent co-victims

One report usually means more affected users who didn't write in. Derive the
data signature of the broken state and scan production (read-only) for it —
e.g. for identity drift: own-mailbox `key_email_access.target_email` ≠
`users.email`; at-risk: Clerk multi-email profiles or primary/Google-account
mismatches. Cross-reference each hit with PostHog: did they ever get a
successful tool call? Users who churned on day one with the signature are
win-back outreach candidates — list them for Ken with evidence, and add the
signature to the daily health-check watch items
(`~/.claude/scheduled-tasks/fgac-user-behavior-review/SKILL.md`).

## 6. The final reply — Ken's voice

Model the resolution email on the actual copy Ken sent in the reference
case. Structure and style:

```
Hi <Name>,

Update as promised. Here's the root cause analysis and update.

*What happened:* on <date>, <the off-script step, plainly stated>. That step
isn't part of any standard FGAC.ai flow and should have been <disabled/
guarded>. I've <prevention shipped — e.g. "updated our auth provider
settings to prevent others from falling into that same trap"> and <account
remediation done for them — e.g. "removed the second email from the
account">. <One sentence of cause, minimal internals: "The second email
confused the auth permissions, resulting in the error you experienced.">

<What works now and the one concrete next step, with a self-serve link:>
Google Sheet access should now be working for *<their-address>*. You may
need to <step>. Please refer to the <linked fgac.ai use-case page>.

*If your goal is <the inferred underlying goal> as well*, the way to do that
is <feature>. Please follow the <linked instructions/video>:

   1. Sign out of FGAC.ai with *<address A>*
   2. Sign in/up at FGAC.ai as *<address B>* to create its own account.
   3. On that account's Accounts page (https://fgac.ai/dashboard/accounts),
      click *"Delegate Access"* and specify <address A>.
   4. Sign out of FGAC.ai with *<address B>*
   5. Sign in to FGAC.ai with *<address A>*

Your detailed issue report helped narrow this down quickly!

Please don't hesitate to reach out if you run into any other issues.

Thank You,
Ken
```

Style rules distilled from Ken's edits:

- Short. Lead with "Update as promised" when a triage reply promised one.
- Bold/emphasize email addresses; they're the load-bearing nouns.
- Say what *we changed* (prevention + remediation done for them) rather than
  exposing internals — one plain-language sentence of cause is enough.
- Always give the one concrete next step and link the fgac.ai use-case page
  (not raw video URLs) for anything self-serve.
- Address the inferred underlying goal ("If your goal is X…") with complete
  numbered steps, including the explicit sign-out/sign-in cycling.
- Credit their report; invite follow-up. No over-apology, no "you did
  everything right," no unverified claims.

## 7. Close the loop

- Bug report doc committed (sanitized), fix PR linked.
- Daily health-check task updated with the new watch item / event.
- Memory updated if the case revealed a durable operational fact.
- Draft placed for Ken; Ken sends.
