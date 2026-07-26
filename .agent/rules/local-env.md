---
trigger: always_on
---

# Local Development Environment

> Mirror of the "Local Development Environment" section in `CLAUDE.md`. Keep both in sync.

There is exactly one supported way to run this app locally. Do NOT improvise an
environment — no local Postgres in Docker, no hand-written `.env.local`, no Clerk
keyless mode. Those all produce an app that appears to work while testing a stack that
does not match production.

```bash
npx vercel link --yes --project fine-grain-access-control   # once per clone
npx vercel env pull .env.local --environment=development     # dev Clerk + Neon creds
npm run db:branch                                            # isolated Neon branch
npm run dev:qa                                               # webpack, 8GB heap
```

1. **Node version**: system Node may be older than Next's `>=20.9` requirement. Use the
   Node 22 install (`~/local/node22/bin`).
2. **Verify Clerk is real**: the dev server log must say
   `Clerk has been loaded with development keys`. If it says *keyless mode*, the pull did
   not work and you are testing against a throwaway Clerk instance.
3. **Verify Neon isolation**: `.env.local` must contain `neon__POSTGRES_URL` pointing at a
   branch named after your git branch.
4. **Never copy a whole `.env.local` between machines** — it carries another machine's
   `neon__POSTGRES_URL` and will silently point you at someone else's database branch.
   Copy individual missing keys.
5. **Signing in is the user's job.** Agents do not create accounts or enter credentials.
6. `scripts/qa-secrets.sh` pulls 1Password *test account emails* only — it does not
   populate app secrets.
