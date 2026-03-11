---
trigger: always_on
---

# Database Rules

When performing tasks involving the database or schema changes, you MUST follow these rules:

1.  **Isolation First**: BEFORE creating any migration or pushing schema changes, ALWAYS run `npm run db:branch` to ensure you are connected to an isolated development branch for your Drizzle-Kit execution.
2.  **Verify Connection**: Use the output of `db:branch` to confirm you are NOT connected to the production database branch (unless explicitly instructed for a hotfix, which requires extreme caution).
3.  **No Manual Prod Migrations**: NEVER run `drizzle-kit push` or `migrate` manually against a production connection string. Production changes should happen via CI/CD.
4.  **Schema Changes**: Modifying `src/db/schema.ts` requires a subsequent `npm run db:push` to your local branch to verify correctness.
5.  **Environment Variables**: NEVER commit `.env` or `.env.local` files containing database credentials.
