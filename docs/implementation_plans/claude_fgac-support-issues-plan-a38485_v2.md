# Support-issue remediation plan — v2 (root cause of Issue 1 confirmed in production data)

Delta over v1 (same file name, _v1.md). Only Issue 1's diagnosis and PR 1's scope
change; Issues 2–7 and PRs 2–5 are unchanged from v1. Issues 5+6+7 are being
implemented as a single PR via a spawned background task (chip task_5d33fc1c).

## Confirmed root cause of Issue 1 (PostHog, project 343912, 2026-08-30 UTC)

The reconnect flow is NOT broken and there is NO Clerk scope misconfiguration.
The demo-session failure was a **wrong-signed-in-user reconnect** — the same
unbound-link class as Issue 5:

- 15:38:23Z `$mcp_tool_call google_api_modify` fails `google_scope_missing=true`
  for FGAC user silly.demo.fgac.ai@gmail.com (Demo connector).
- 15:38:43Z `?reconnect=1` pageview + `google_reconnect_started` fired by FGAC user
  **test.fgac.ai@gmail.com** — the browser was signed in to the wrong FGAC account.
  15:38:47Z `?reconnected=1` ("✓ Google reconnected") for that wrong user.
- 15:39–15:43Z three more demo-connector failures (4 total, matching the email).
- 15:45:20Z onward: agent switches to the Test connector (test.fgac.ai) — succeeds
  on the first call (that user's grant was always fine).
- **Zero `google_reconnect_started` events exist for the silly.demo FGAC user.**
  Every completed consent ran against test.fgac.ai; the demo account was never
  reconnected at all.

Control group, same day: 2konark…@gmail.com (02:56Z) and jeremiah@… (20:24Z) hit
`google_scope_missing`, reconnected **as themselves**, and progressed (2konark:
successful `docs_edit` at 03:42Z). The reconnect flow grants drive.file correctly
when the right user runs it. → v1's "Action 0: check Clerk dashboard for
drive.file" is withdrawn as unnecessary.

Issues 2/3 confirmed independent: 15:50:57–15:54:27Z shows 8 `docs_edit` successes
interleaved with 5 `docs_read_document` read-backs on the correctly-scoped test
connector — Google returned 200 on every write; the agent detected the partial
delete/style bleed only by re-reading. `docs_replace_body` plan (PR 4) unchanged.

Prevalence note: 5 distinct production users hit `google_scope_missing` on
2026-08-30 alone (incl. kenyesh@gmail.com at 23:46Z via ClaudeAI), so the
scope-truthfulness work retains value beyond this incident.

## Revised PR 1 scope

**Reframed:** Issue 1 is an *unbound account-fixing link* plus *no mismatch
feedback* — the reconnect twin of Issue 5. Priorities within PR 1:

1. **NEW — bind the reconnect deep link to the intended account.** The
   `?reconnect=1` link minted in denial messages (`route.ts:631,660,673,1253,1291,1320`,
   proxy `:718`) should carry the intended FGAC user / target email (e.g.
   `&for=<email>` or a short signed param). `ReconnectGoogleButton` /
   `accounts/page.tsx` compares it to the signed-in user and, on mismatch, renders
   the wrong-account warning (same pattern as Issue 5's card; model on
   `accounts/page.tsx:101-114`) instead of auto-firing the reconnect. This single
   change would have prevented the entire reported incident.
2. Honest post-reconnect verification on `?reconnected=1` (v1 item, kept — with the
   4×1500ms scope-propagation poll).
3. Per-scope badges via `googleAccess.ts` returning `{ gmail, driveFile }` (kept).
4. `list_accounts` per-account scope state (kept; three-state values, allSettled,
   analytics `via` discriminator). This would have let the *agent* detect the
   mismatch before its first failing call.
5. Reconnect legs scope hygiene (`ConnectGoogleWarning` drive.file,
   `createExternalAccount` additionalScopes) — kept but now hardening, not the fix.
6. Withdrawn: Clerk dashboard scope check (disproven); deprioritized: the
   destroy+recreate `oidcPrompt` question (no evidence it fired in this incident).

**Immediate remediation (no deploy):** sign in to fgac.ai as
silly.demo.fgac.ai@gmail.com and run Reconnect Google once — the account has
simply never completed a drive.file consent.
