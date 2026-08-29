# gmail_get_attachment 404 self-heal — v2

Branch: `claude/gmail-attachment-selfheal` (PR #94). Supersedes v1 after the
PostHog connector became available mid-session and production probes settled
Google's actual error semantics.

## What changed vs v1

1. **Numbers verified** (PostHog project 343912, external users, 2026-08-21 →
   2026-08-28): 121 calls, 53 errors (43.8%), 38× error_status 404, 13× null,
   2× 403 — matches the trigger report. Daily series: the 404s were a burst on
   08-24→08-26 (37 of 38); after PR #89's improved error text deployed
   (08-27 ~11:34Z) the tool ran 31 calls with 1 error (which predates the
   deploy). The nudge already works; the self-heal removes the counted error
   entirely.
2. **Null-error_status failures resolved**: all 13 are `outcome='failed'`
   with no `failure_reason` — account-resolution failures
   (`resolveAccountAndToken`) that never reach Google, from before
   `failure_reason` instrumentation deployed. Not a Google-path problem.
3. **Sequence reconstruction**: the 404 population is mixed. Clear
   stale-id recoveries (attachment 404 → gmail_read success → attachment
   success) AND dead-messageId retry loops (gmail_read itself 404s, agents
   loop). The self-heal targets the first class; PR #89's STOP text covers
   the second.
4. **Google semantics measured against production** (own-mailbox read-only
   probes via the claude.ai connector):
   - corrupted/truncated attachmentId → **400 "Invalid attachment token"**,
     not 404;
   - a well-formed token fetches its blob **regardless of the messageId in
     the URL** (tokens are self-contained) — so production 404s are
     specifically tokens Gmail has invalidated (re-index), the healable
     class;
   - consequence: the self-heal now triggers on **404 or 400** after a
     successful parent read — both mean "this id will never work, the message
     is fine", and 400 additionally covers hallucinated/truncated ids.

## Validation status

- `tsc`, `eslint`, `mcp:lint` clean; preview deployment green (deploy-watcher
  verified commit SHA).
- Live exercise of the *new* branches is not reachable this session: the
  claude.ai connector pins production (old code, can't reach localhost or the
  preview), and the local CLI connector path is blocked by an expired
  `claude` OAuth session (user action). The recovery branches are small,
  typechecked, and instrumented — `attachment_selfheal` /
  `attachment_selector` (docs/analytics.md) prove or refute them in
  production data after deploy.

## Post-deploy confirmation query (unchanged)

Breakdown of `attachment_selfheal` for `$mcp_tool_name='gmail_get_attachment'`,
external users: fix confirmed when `recovered` absorbs former 404/400 errors
and the tool's error rate converges toward the other Gmail read tools.
