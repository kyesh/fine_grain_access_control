# Google sign-in narrows the Clerk grant — v3 (correction after the second expiry probe)

Branch: `claude/dazzling-driscoll-46d685`, PR #118. Amends v2 in one place.

## What changed since v2

v2 stated that after a narrowing sign-in the first refreshed token carries
drive.file again (USER_A, probed 18:59Z). A second observation contradicts the
generality: USER_B, narrowed by a sign-in on the preview at 19:43Z, refreshed at
20:50Z to a token that was **still narrow** — Clerk had a narrow refresh token
this time. Why the two sign-ins differed (USER_B had gone through a no-consent
reauthorize between its consent pass and the sign-in) is not established.

So the "returns on its own within an hour" self-heal is real for some accounts
(production `--tokens` sweep: 8 of 136 narrow-record accounts serve a wide token,
4 of them Sheets/Docs users) but not a rule. Consequences:

1. The card copy and the MCP denial message no longer promise the hour. They
   say a sign-in resets the Drive permission and reconnecting restores it.
2. The tokeninfo-confirmed pre-flight is unchanged in behaviour and now a pure,
   unit-tested decision (`reconcileScopes` in `src/lib/googleTokenScopes.ts`,
   `scripts/test-google-token-scopes.ts` in `mcp:lint`): record complete → no
   lookup; record gap + wide token → allow and flag `clerk_scope_cache_stale`;
   record gap + narrow token → deny; tokeninfo unavailable → record stands.
3. The post-sign-in auto-repair matters more, not less: it is the only path
   that reliably restores drive.file right after the sign-in that removed it.

## QA outcome (capability 18, local + PR preview)

| assertion | local | preview |
|---|---|---|
| A9 auto-repair after a narrowing sign-in (one-account chooser, no consent, verified on Accounts, once per sign-in) | pass | pass |
| A10 card names the missing scope, no auto-redirect for a rule-less account | pass | pass |
| A11 pre-flight trusts the token | denial path verified on the deployed build (record narrow + token narrow → `drive_file: missing` from `list_accounts`); allow path (record narrow + token wide) covered by the unit test — the live fixture did not re-form within the session (USER_B refreshed narrow); it exists in production for 8 accounts, so the first `$mcp_tool_call` with `clerk_scope_cache_stale = true` after deploy is the end-to-end proof (query in monitoring §7.12) | as local |

Silent-reauthorize survival (the v2 basis for `select_account`): USER_B's
no-consent re-widen at 18:07Z refreshed WIDE at 19:09Z — that measurement stands.
