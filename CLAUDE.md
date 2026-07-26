# FGAC.ai — Project Rules

> This file is the single source of truth for project rules. Workflows (slash commands)
> live in `.claude/commands/`. The legacy Antigravity tree (`.agent/`) has been retired —
> everything it contained was folded in here or into `.claude/commands/`.

## General Workflow

1. **Branching**: Always pull the latest changes from main and create a new branch when starting new work.
2. **Database Changes**: Follow the Database Rules below. Always run `npm run db:branch` BEFORE schema changes to enforce Neon branching.
3. **Implementation Plans**: Document implementation plans as you normally would, but save a copy of each revision to `docs/implementation_plans/[branch_name]_v[revision].md`. If the file already exists, increment the revision number instead of editing it. This keeps a reviewable history of how plans evolved for QA and validation work.
4. Review the `docs/` folder and update the docs and data model to match your changes.
5. Commit frequently as you work through the problem.
6. **Validation**: Validate changes locally, then in the preview branch via `/deploy-pr-preview`, running the applicable `docs/QA_Acceptance_Test` suites before handing back to the user.
7. **Browser Automation**: In Claude Code, use the **built-in browser tools** (`mcp__Claude_Browser__*`) for ALL UI testing — `preview_start`, `navigate`, `get_page_text`, `read_page`, `read_console_messages`, `read_network_requests`, `computer`, `resize_window` (viewport + light/dark emulation). NEVER write ad-hoc Node.js browser scripts. **The built-in browser keeps persistent cookies, and both QA Google accounts (`USER_A`, `USER_B`) are signed in there** — so signed-in flows (dashboard, Clerk sign-in via the Google account chooser, OAuth consent) run in the built-in browser too; switching accounts through the chooser is the standing-approved routine step. Verify rather than assume: if a flow lands on a Google *password* prompt, the session has expired — STOP (never type a password) and fall back to the Playwright CLI CDP path (Path B in `/browser-agent`), which attaches to the dedicated signed-in Chrome profile. Path B is the backup for expired/missing built-in sessions, not an alternative default. See `/browser-agent` for both paths.

## QA Subagent Architecture

QA execution is delegated to cost-tiered subagents defined in `.claude/agents/`:
`qa-env-runner` (Sonnet) executes runbooks and writes
`docs/QA_Acceptance_Test/qa-results.json`; `qa-smoke` and `deploy-watcher` (Haiku) handle
mechanical polling and smoke checks; `qa-coverage-auditor` (Sonnet) adversarially reviews
results; `qa-setup-driver` (inherits the session model) drives the browser setup flows.
Two rules bind this architecture:

1. **Only the orchestrator (main session) edits source, schema, or config.** Runners
   execute and report; a runner that hits a code problem records it, never fixes it.
2. **`npx tsx scripts/qa-coverage-check.ts` is the arbiter of QA completeness** — it
   parses the `### A<n>:` assertions in `docs/QA_Acceptance_Test/capabilities/` and
   validates `qa-results.json` (schema in `docs/QA_Acceptance_Test/README.md`). Prose
   assertion counts are informational.

QA environments run sequentially (they share one dev server, one Neon branch, and the QA
accounts/keys — lifecycle capabilities mutate that shared state). Targeted re-tests
re-dispatch a runner scoped to the failed capabilities only, bounded at 3 fix-and-retest
rounds.

## Local Development Environment

There is exactly one supported way to run this app locally. Do NOT improvise an
environment — no local Postgres in Docker, no hand-written `.env.local`, no Clerk
keyless mode. Those all produce an app that appears to work while testing a stack
that does not match production.

```bash
npx vercel link --yes --project fine-grain-access-control   # once per clone
npx vercel env pull .env.local --environment=development     # dev Clerk + Neon creds
npm run db:branch                                            # isolated Neon branch
npm run dev:qa                                               # webpack, 8GB heap
```

Notes:

1. **Node version**: system Node may be older than Next's `>=20.9` requirement. Use the
   Node 22 install (`~/local/node22/bin`) — `.claude/launch.json` already wraps `dev:qa`
   so `preview_start` resolves it correctly.
2. **Verify Clerk is real**: the dev server log must say
   `Clerk has been loaded with development keys`. If it says *keyless mode*, the pull
   did not work and you are testing against a throwaway Clerk instance.
3. **Verify Neon isolation**: `.env.local` must contain `neon__POSTGRES_URL` pointing at
   a branch named after your git branch. `db:branch` writes it.
4. **Never copy a whole `.env.local` between machines** — it carries another machine's
   `neon__POSTGRES_URL` and will silently point you at someone else's database branch.
   Copy individual missing keys.
5. **Switch freely between the two QA test users. Never ask permission to do it.**

   `USER_A` and `USER_B` from `.qa_test_emails.json` both stay signed in to Google on the
   QA machine. Signing out of Clerk and back in as either one is a **routine step of the
   harness**, exactly like clicking a button — not a decision, not an approval point, not
   something to confirm, flag, or check in about. Do it as many times as the tests
   require and simply carry on. Clicking through Google's account chooser and Clerk's
   OAuth consent for these two accounts is included in this standing approval.

   Do not ask again. Do not end a turn asking whether you may switch. Do not treat a
   previous approval as single-use — this rule *is* the approval, permanently, for every
   QA run. If a test needs the other account, switch and keep going.

   Three hard limits remain (these are about safety, not permission):
   - **Never type a password.** Both accounts are already authenticated with Google. If a
     password, passkey, or 2FA prompt ever appears, stop and hand back to the user.
   - **Never create a new account.** If an expected test account is missing, say so
     rather than signing up.
   - Only these two accounts, and only against a local or preview deployment. Outside a
     QA run, or for any other account, sign-in remains the user's job.
6. `bash scripts/qa-secrets.sh` pulls the 1Password *test account emails* only — it does
   not populate app secrets. Do not confuse the two.

These rules are enforced by `.claude/hooks/guard-local-env.sh` (PreToolUse), which blocks
local database containers, schema pushes without an isolated branch, and hand-written
`.env` files.

## Production Credentials on a Local Machine

Pulling live credentials for diagnostics is fine. Letting them become the *ambient*
environment is not. The rules below exist so that "am I pointed at prod?" is never a
question you have to hold in your head.

**Check first, always:**

```bash
npm run env:check
```

Prints the resolved database host, whether it is the production branch, which Clerk
instance the secret belongs to, whether the two are consistent, and whether any
production URL is sitting in the environment.

**Pull production credentials only to `.secrets/`:**

```bash
npx vercel env pull .secrets/prod.env --environment=production
```

`.secrets/` is gitignored and nothing auto-loads it. Do **not** use
`.env.production.local` — Next.js auto-loads that name whenever `NODE_ENV=production`, so
a local `npm run build && npm start` would silently run against production. Delete
`.secrets/prod.env` when finished.

**Never copy production values into `.env.local`.** That file is development-only.

**How the app protects itself** (`src/db/connectionSafety.ts`):

- Outside a production runtime the ONLY accepted connection is `neon__POSTGRES_URL`
  (written by `npm run db:branch`). There is no fallback chain — a missing branch URL is
  a hard error, not a reason to try `POSTGRES_URL` or `DATABASE_URL`, both of which point
  at production in a pulled `.env.local`.
- The resolved host is checked against the production endpoint and refused outside
  production, so even a branch variable containing a prod URL is caught.

**Scripts that touch production** must require an explicit `--prod`, read `.secrets/prod.env`
by name, and refuse to write unless `--apply` is also given. See
`scripts/tombstone-orphaned-users.ts` for the pattern.

**Clerk instance must match the database.** Production user ids do not exist in the
development Clerk instance — every lookup 404s and reads as "account deleted". Any script
that infers state from Clerk must verify the key mode (`sk_live_` vs `sk_test_`) and bail
if a majority of users resolve as deleted. The branch database is a copy of main, so its
user ids are production-instance ids too.

## Database Rules

1. **Isolation First**: BEFORE creating any migration or pushing schema changes, ALWAYS run `npm run db:branch` so Drizzle-Kit executes against an isolated development branch.
2. **Verify Connection**: Use the output of `db:branch` to confirm you are NOT connected to the production database branch (unless explicitly instructed for a hotfix, which requires extreme caution).
3. **No Manual Prod Migrations**: NEVER run `drizzle-kit push` or `migrate` manually against a production connection string. Production changes happen via CI/CD.
4. **Schema Changes**: Modifying `src/db/schema.ts` requires a subsequent `npm run db:push` to your local branch to verify correctness.
5. **Drizzle/Migration Safety**: `drizzle.config.ts` and `src/db/migrate.ts` carry environment safety guards. On a feature branch (not `main`) they crash rather than implicitly falling back to production parameters (e.g. `DATABASE_URL`). Do not bypass this. If it halts, ensure your branch was populated via `npm run db:branch`.
6. **Environment Variables**: NEVER commit `.env` or `.env.local` files containing database credentials.
7. **No Direct DB Writes During QA**: NEVER write ad-hoc scripts (`psql`, `npx tsx`, raw SQL, Drizzle ORM scripts) that INSERT, UPDATE, or DELETE application data to simulate user actions during QA. QA exists to validate the real user flow. All state changes (approving connections, creating keys, configuring rules) MUST go through the Web UI via `/browser-agent` or the application's own API endpoints — exactly as a real user would. Direct DB manipulation bypasses the authorization checks the tests are meant to validate and can create invalid cross-user data bindings. Read-only queries for debugging are fine.
8. **Migration File Verification**: After `drizzle-kit generate`, ALWAYS verify (a) the new `.sql` file exists in `src/db/migrations/`, (b) `migrate.ts` will pick it up (it uses a dynamic `readdirSync` — confirm the `.sql` extension and `NNNN_*.sql` naming convention), and (c) `npm run db:migrate` succeeds locally against your dev branch. NEVER assume a generated migration will be discovered without verification.

## This Repository Is Public

`kyesh/fine_grain_access_control` is open source. Everything pushed or posted — code,
commit messages, issues, PRs, comments, releases — is world-readable, permanently and
immediately.

**Never put customer data in anything that reaches GitHub.** That means real email
addresses, Clerk user ids (`user_...`), proxy keys (`sk_proxy_...`), delegation or
connection ids tied to a person, and database rows quoted verbatim.

This applies to *diagnostic* content as much as code. Triaging production data is normal;
pasting the results into an issue is not. Refer to the query or the local report instead:

> Two addresses carry active keys — run `npm run db:tombstone-orphans -- --prod` to see them.

not

> ~~Two addresses carry active keys: alice@example-university.edu and bob@example-corp.com~~

**Editing does not undo publication.** GitHub retains edit history on issues and PRs and
shows it to anyone. The only real remedy is deleting the issue/PR, which destroys the
thread. Treat every post as final.

**If it happens anyway**: delete the issue/PR (not just edit it), check whether the data
also reached commit messages or files (`git log --all -S '<value>'`), recreate the content
sanitised, and tell the user what was exposed and for how long.

Enforced by `.claude/hooks/guard-public-content.sh` (PreToolUse), which blocks
`gh issue/pr create|edit|comment`, `gh gist create`, and `gh release create` when the body
— inline or via `--body-file` — contains an email address outside the allowlist, a proxy
key, or a Clerk user id. Reads (`view`, `list`, `checks`) are unaffected.

## Security, Safety, and Workflow Best Practices

- **Strict UI Policy**: Put debug information exclusively in server logs. NEVER render debug identifiers, developer tokens, or internal error objects into the HTML/UI.
- **Git Hook Restrictions**: NEVER bypass Git hooks (`--no-verify`) without explicit user approval. Stop and investigate failures such as secret scanning to prevent compromised credentials.
- **Never Push to Main**: NEVER push directly or merge automatically to `main`. Always open a PR, use `/deploy-pr-preview` for validation, and leave `/deploy-prod` to the user.
- **Never Deploy to Production**: NEVER run `npx vercel --prod`, `vercel --prod`, `vercel deploy --prod`, or ANY command that triggers a production deployment, regardless of how small the change appears. Production deployments are done ONLY by the user via `/deploy-prod`. If a production redeploy is needed (e.g. after env var changes), tell the user and let them trigger it.

### Vercel CLI Safety

Safe, no approval needed:
- `vercel env ls` — list environment variables
- `vercel env pull` — pull env vars to local files
- `vercel inspect` — inspect deployments
- `vercel ls` / `vercel logs` — list and read deployments

State-modifying, require user approval (but NOT production deployments):
- `vercel env add` / `vercel env rm` — add or remove environment variables
- `vercel cancel` — cancel a queued or building deployment

**BANNED** — never run:
- `vercel --prod` / `vercel deploy --prod` — deploys to production
- `vercel promote` — promotes a deployment to production
- `vercel alias` — aliases a deployment to a production domain

These bans are additionally enforced as `deny` rules in `.claude/settings.json`.

## Context Efficiency & Session Hygiene

Originally derived from Antigravity's session-stability rules; the IDE-specific parts
(ptyHost crash pacing, `waitForPreviousTools`, `command_status` polling) do not apply to
Claude Code and were dropped. What remains are the rules that still hold here.

1. **Batch related shell checks into one command.** Instead of five separate `curl` calls, run one command with `curl ... && curl ... && curl ...`. Independent commands may be issued in parallel in a single response.
2. **Playwright snapshots**: ALWAYS pipe through `grep` to extract only relevant elements.
   - Bad: `npx @playwright/cli -s=foo snapshot`
   - Good: `npx @playwright/cli -s=foo snapshot 2>&1 | grep -E "heading|button|Agent|Approve" | head -10`
3. **Command output**: pipe long output through `head`/`tail`/`grep` rather than dumping it whole.
4. **File reads**: use `Read` with `offset`/`limit` when you know which section you need.
5. **NEVER leave binary files** (PNGs, PDFs) in the project root. Save QA screenshots to a gitignored directory or delete them after use.
6. **NEVER create `node_modules`** outside the project root without adding it to `.gitignore`.
7. **Before starting a QA session**, verify the workspace is clean: `git status --short | grep '^??' | wc -l` should be under 20.
8. **Kill stale processes** from crashed sessions before restarting: `pkill -f 'chrome.*playwright_user_data'`. Never plain `pkill chrome` — that kills the user's real browser.
9. **After an interrupted session**, use `/recover-session` to rebuild context from compact artifacts and git state rather than re-reading a long transcript.
10. At natural phase boundaries, write a walkthrough artifact and update the task list for cross-session continuity.
