---
trigger: always_on
---

# Database Rules

When performing tasks involving the database or schema changes, you MUST follow these rules:

1.  **Isolation First**: BEFORE creating any migration or pushing schema changes, ALWAYS run `npm run db:branch` to ensure you are connected to an isolated development branch for your Drizzle-Kit execution.
2.  **Verify Connection**: Use the output of `db:branch` to confirm you are NOT connected to the production database branch (unless explicitly instructed for a hotfix, which requires extreme caution).
3.  **No Manual Prod Migrations**: NEVER run `drizzle-kit push` or `migrate` manually against a production connection string. Production changes should happen via CI/CD.
4.  **Schema Changes**: Modifying `src/db/schema.ts` requires a subsequent `npm run db:push` to your local branch to verify correctness.
5.  **Drizzle/Migration Safety**: `drizzle.config.ts` and `src/db/migrate.ts` have been actively injected with environment safety guards. If you are on a feature branch (not `main`), they will explicitly crash instead of implicitly falling back to production parameters (e.g. `DATABASE_URL`). Do not bypass this safety loop! If it halts, ensure your branch was populated using `npm run db:branch`.
6.  **Environment Variables**: NEVER commit `.env` or `.env.local` files containing database credentials.
7.  **No Direct DB Writes During QA**: NEVER write ad-hoc scripts (`psql`, `npx tsx`, raw SQL, Drizzle ORM scripts) that INSERT, UPDATE, or DELETE application data to simulate user actions during QA testing. QA tests exist to validate the real user flow. All state changes (approving connections, creating keys, configuring rules) MUST go through the Web UI via `/browser-agent` or through the application's own API endpoints — exactly as a real user would. Direct DB manipulation bypasses the authorization checks the tests are supposed to validate and can create invalid cross-user data bindings. Read-only queries for debugging are acceptable.
8.  **Migration File Verification**: After running `drizzle-kit generate`, ALWAYS verify: (a) the new `.sql` file exists in `src/db/migrations/`, (b) `migrate.ts` will pick it up (currently uses dynamic `readdirSync` — verify the file has a `.sql` extension and follows the `NNNN_*.sql` naming convention), and (c) run `npm run db:migrate` locally against your dev branch to confirm the migration executes successfully. NEVER assume a generated migration file will be automatically discovered without verification.
