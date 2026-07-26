# FGAC.ai — Project Rules

> These rules are the Claude Code port of `.agent/rules/` (Antigravity). Both trees are
> kept in sync; if you change a rule here, mirror it in `.agent/rules/` and vice versa.
> Workflows live in `.claude/commands/` (mirror of `.agent/workflows/`).

## General Workflow

1. **Branching**: Always pull the latest changes from main and create a new branch when starting new work.
2. **Database Changes**: Follow the Database Rules below. Always run `npm run db:branch` BEFORE schema changes to enforce Neon branching.
3. **Implementation Plans**: Document implementation plans as you normally would, but save a copy of each revision to `docs/implementation_plans/[branch_name]_v[revision].md`. If the file already exists, increment the revision number instead of editing it. This keeps a reviewable history of how plans evolved for QA and validation work.
4. Review the `docs/` folder and update the docs and data model to match your changes.
5. Commit frequently as you work through the problem.
6. **Validation**: Validate changes locally, then in the preview branch via `/deploy-pr-preview`, running the applicable `docs/QA_Acceptance_Test` suites before handing back to the user.
7. **Browser Automation**: In Claude Code, use the **built-in browser tools** (`mcp__Claude_Browser__*`) to analyze or test the UI — `preview_start`, `navigate`, `get_page_text`, `read_page`, `read_console_messages`, `read_network_requests`, `computer`. NEVER write ad-hoc Node.js browser scripts. The Playwright CLI path described in `.agent/workflows/browser-agent.md` is the Antigravity equivalent and is not the default here; reach for it only when a test genuinely needs the user's logged-in Chrome profile over CDP. See `/browser-agent` for both paths and their trade-offs.

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
5. **Signing in is the user's job.** Agents do not create accounts or enter credentials.
   Ask the user to sign in, then continue.
6. `bash scripts/qa-secrets.sh` pulls the 1Password *test account emails* only — it does
   not populate app secrets. Do not confuse the two.

These rules are enforced by `.claude/hooks/guard-local-env.sh` (PreToolUse), which blocks
local database containers, schema pushes without an isolated branch, and hand-written
`.env` files.

## Database Rules

1. **Isolation First**: BEFORE creating any migration or pushing schema changes, ALWAYS run `npm run db:branch` so Drizzle-Kit executes against an isolated development branch.
2. **Verify Connection**: Use the output of `db:branch` to confirm you are NOT connected to the production database branch (unless explicitly instructed for a hotfix, which requires extreme caution).
3. **No Manual Prod Migrations**: NEVER run `drizzle-kit push` or `migrate` manually against a production connection string. Production changes happen via CI/CD.
4. **Schema Changes**: Modifying `src/db/schema.ts` requires a subsequent `npm run db:push` to your local branch to verify correctness.
5. **Drizzle/Migration Safety**: `drizzle.config.ts` and `src/db/migrate.ts` carry environment safety guards. On a feature branch (not `main`) they crash rather than implicitly falling back to production parameters (e.g. `DATABASE_URL`). Do not bypass this. If it halts, ensure your branch was populated via `npm run db:branch`.
6. **Environment Variables**: NEVER commit `.env` or `.env.local` files containing database credentials.
7. **No Direct DB Writes During QA**: NEVER write ad-hoc scripts (`psql`, `npx tsx`, raw SQL, Drizzle ORM scripts) that INSERT, UPDATE, or DELETE application data to simulate user actions during QA. QA exists to validate the real user flow. All state changes (approving connections, creating keys, configuring rules) MUST go through the Web UI via `/browser-agent` or the application's own API endpoints — exactly as a real user would. Direct DB manipulation bypasses the authorization checks the tests are meant to validate and can create invalid cross-user data bindings. Read-only queries for debugging are fine.
8. **Migration File Verification**: After `drizzle-kit generate`, ALWAYS verify (a) the new `.sql` file exists in `src/db/migrations/`, (b) `migrate.ts` will pick it up (it uses a dynamic `readdirSync` — confirm the `.sql` extension and `NNNN_*.sql` naming convention), and (c) `npm run db:migrate` succeeds locally against your dev branch. NEVER assume a generated migration will be discovered without verification.

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

Ported from `.agent/rules/session-stability.md`. The Antigravity-specific parts (ptyHost
crash pacing, `waitForPreviousTools`, `command_status` polling) do not apply to Claude Code
and have been dropped; what remains are the rules that still hold here.

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
