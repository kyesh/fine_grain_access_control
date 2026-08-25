---
description: Handle a support email end-to-end — investigate via a root-cause agent, ship a preventive fix, draft the reply to the reporter, find other affected users, and draft proactive outreach to get them back on track
---

# Support Triage

Run this when a support email arrives. Public-facing support address:
**support@fgac.ai**. It forwards into a private operator mailbox — that
address lives in local memory/config only (never in this repo). Read it
through the **production** FGAC MCP connector (`gmail_list` / `gmail_read`
with `account: '<operator mailbox from local memory>'`; full threads via
`google_api_get` `gmail/v1/users/me/threads/{id}`). Reference case: the
2026-08-24 identity drift issue —
`docs/bug_reports/identity_email_drift_breaks_token_lookup.md`.

**Hard rules:**

- **Never send email.** Every message is a draft the operator reviews and
  sends. The FGAC proxy blocks Gmail draft creation (`messages/send` is its
  only Gmail write), so create drafts with the operator's direct Gmail MCP —
  they land in that MCP's authenticated personal account; remind the
  operator to switch From to support@fgac.ai (or move the copy into the
  support mailbox) at send time.
- **Production access is read-only.** SELECTs and GET-only calls. Pull creds
  with `npx vercel env pull .secrets/prod.env --environment=production`, run
  scripts from inside `.secrets/` (gitignored; module resolution works
  there), delete `.secrets/prod.env` and any scripts when done.
- **Public-repo rules — and they cover operators too**: no real email
  addresses of any kind (customer OR internal/personal), Clerk ids, proxy
  keys, or verbatim DB rows in anything that reaches GitHub. support@fgac.ai
  is the only address that may appear. Placeholders elsewhere. The husky
  pre-commit/commit-msg hooks enforce this on newly added lines; treat a
  block as a real catch, never bypass with --no-verify.
- **Account writes are the operator's call** (Clerk edits, data repair).
  Propose the exact change; never execute it. If an outreach draft promises
  remediation ("we are removing X"), list the pending manual actions
  explicitly.

First, acknowledge: draft a short same-day reply — the clarifying question
that best splits the hypothesis space, links to the relevant self-serve
pages (https://fgac.ai/use-cases/google-sheets-agent,
https://fgac.ai/use-cases/multiple-gmail-accounts, https://fgac.ai/setup),
and a commitment: "Let me investigate and I'll get back to you with an
update later today."

Then the five core steps:

## 1. Kick off an investigation agent for root-cause analysis

Dispatch a subagent (general-purpose; background) to reconstruct ground
truth — user reports describe *symptoms* accurately and *causes* wrongly,
because the UI they're reading may itself be the bug. The agent should:

- **Repo**: grep the exact quoted error string, read the code path that
  emits it, note what it keys on.
- **Production DB** (read-only): the user's `users` row, `proxy_keys`,
  `key_email_access` (own-mailbox rows have `delegation_id IS NULL`),
  `email_delegations`. Compare every email field.
- **Clerk** (read-only; verify `sk_live_`): `GET /v1/users/{clerk_user_id}`.
  Forensic gold: `email_addresses[].verification.strategy` (`email_code` =
  typed by hand, `from_oauth_google` = arrived via OAuth), `linked_to`, and
  `external_accounts[].created_at/updated_at` (shows whether reconnects
  actually succeeded).
- **PostHog**: `$mcp_tool_call`/`mcp_tool_call` outcomes,
  `google_token_fetch_failed`, `google_token_identity_fallback`,
  `proxy_request` for their addresses — when did failures start, what did
  they try.

Output: a timeline, then two separate honest statements — **what the user
did off-script** (with timestamps, no blame) and **what our system did
wrong** in response (mishandled the step, displayed something misleading, or
emitted an error pointing away from the cause). Never conclude "user error"
or "product bug" alone; it is almost always both.

## 2. Prepare a fix preventing others from falling into the same trap

- Code fix through the normal flow: branch off latest main, plan in
  `docs/implementation_plans/`, bug report in `docs/bug_reports/`, PR +
  `/deploy-pr-preview`; the user runs `/deploy-prod`.
- **Prefer self-healing fixes**: tolerate the broken state (fallbacks) AND
  converge it back to correct on next contact, so affected users need zero
  manual steps.
- **Close the entry point**: config/settings changes that remove the trap
  (e.g. auth-provider dashboard options), guard rails or truthful copy near
  the decoy control, corrected guidance in MCP tool responses. Name anything
  only the operator can do as an explicit action item.

## 3. Draft the reply to the user who reached out

House support voice, modeled on the reference case's sent resolution email:

```
Hi <Name>,

Update as promised. Here's the root cause analysis and update.

*What happened:* on <date>, <the off-script step, plainly stated>. That step
isn't part of any standard FGAC.ai flow and should have been <disabled/
guarded>. I've <prevention shipped> and <remediation done for them>. <One
plain sentence of cause — minimal internals.>

<What works now + the one concrete next step, linking the fgac.ai use-case
page:> <X> should now be working for *<their-address>*. You may need to
<step>. Please refer to the <linked page>.

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
<operator first name>
```

Style rules (from operator edits on the reference case): short; lead "Update
as promised"; emphasize email addresses (the load-bearing nouns); say what
*we changed* rather than internals; always one concrete next step with an
fgac.ai use-case link (not raw video URLs); address the inferred underlying
goal with complete numbered steps including sign-out/sign-in cycling; credit
their report; no over-apology, no "you did everything right" unless the data
shows it, no unverified claims.

## 4. Identify other users who fell into the same trap

One report means more affected users who didn't write in. Derive the data
signature of the broken state and scan production (read-only) across **all
live users** — e.g. for identity drift: own-mailbox
`key_email_access.target_email` ≠ `users.email`; at-risk: multi-email
auth-provider profiles, primary/Google mismatches. Cross-reference each hit
with PostHog: did they ever get a successful call, when did they go silent?
Classify: actively broken / silently healed by the fix / at-risk only /
churned on first contact (prime win-back candidates). Add the signature to
the daily health-check watch items (the scheduled task's SKILL.md, local to
the operator's machine).

## 5. Draft proactive outreach to the affected users

One draft per affected user (direct Gmail MCP, drafts only), telling them:
we saw them hit (or be exposed to) the issue, the steps we've taken to
resolve it, and how to get back on track. Template from the reference case:

```
Hi,

We identified a bug on FGAC.ai where <the trap, in one sentence — what
users were attempting and why it didn't work>. The underlying bug has been
fixed, and <the entry point closed>.

Your account was identified as having followed this path, so we are
<remediation, naming their specific details — e.g. "removing the extra
email addresses (<X> and <Y>) from your profile">. Your <what is unaffected
— e.g. "sign-in and Google connection (<address>)"> are unaffected.

If your goal is <the inferred goal>, the supported way is <feature>. Please
follow the setup instructions/video here:
<fgac.ai use-case page URL>

Please don't hesitate to reach out if you run into any issues.

Thank You,
<operator first name>
```

Keep each draft truthful per-recipient (someone merely at-risk gets "could
interfere," not "broke your account"). Finish by reporting to the operator:
where each draft lives, the From-address caveat, and every manual step the
drafts promise that they still need to perform.
