---
trigger: always_on
---

# This Repository Is Public

> Mirror of the "This Repository Is Public" section in `CLAUDE.md`. Keep both in sync.

`kyesh/fine_grain_access_control` is open source. Code, commit messages, issues, PRs,
comments and releases are world-readable, permanently and immediately.

**Never put customer data anywhere that reaches GitHub**: real email addresses, Clerk user
ids (`user_...`), proxy keys (`sk_proxy_...`), per-person delegation or connection ids, or
verbatim database rows.

This applies to diagnostics as much as to code. Investigating production data is normal;
publishing the results is not. Point at the query or the local report instead of naming
records:

> Two addresses carry active keys — run `npm run db:tombstone-orphans -- --prod` to see them.

**Editing does not undo publication.** GitHub retains and displays edit history. The only
real remedy is deleting the issue or PR, which destroys the thread. Treat every post as
final.

**If it happens anyway**: delete (do not merely edit), check whether the value also reached
commit messages or files with `git log --all -S '<value>'`, recreate the content sanitised,
and tell the user what was exposed and for how long.

Enforced by `.claude/hooks/guard-public-content.sh`.
