# Growth prospecting — v2: private workspace layout

Branch: `claude/growth-prospecting` (PR #121) · Date: 2026-09-09 · Follows
`growth-prospecting_v1.md`.

## Problem

v1 kept lead lists and dedupe state in a gitignored `.growth/` inside this
repo. That is safe only as long as nobody un-ignores it, and it gives the
outreach tracker, the private keyword list, and notes about people no home
at all — they must never be committed here, because every push to
`kyesh/fine_grain_access_control` is world-readable.

## Decision: one tree, private parent, public submodule

```
~/GitRepos/fgac-growth/          private GitHub repo
├── CLAUDE.md, README.md         rules + how to run
├── config.json                  overlay: extra queries / feeds / repos / watched authors
├── tracker.md                   lead URL · channel · found→replied→converted · slug · notes
├── seen.json, digests/          written by the script, committed daily
├── .claude/settings.json        re-registers this repo's PreToolUse guards + deny list
└── fgac/                        this repo, git submodule tracking origin/main
```

Ken chose this after weighing the alternatives below. Properties that decided
it:

1. **Product sessions are identical to today.** A session started inside
   `fgac/` sees this repo, this `CLAUDE.md`, these hooks and settings, and
   branches/PRs exactly as before. Nothing in the product workflow learns
   about the parent.
2. **Lead sessions start at the parent** and treat `fgac/` as read-only. The
   parent's `.claude/settings.json` re-registers `guard-local-env.sh` and
   `guard-public-content.sh` by path (`$CLAUDE_PROJECT_DIR/fgac/.claude/hooks/…`)
   and copies the `permissions.deny` list (prod deploy, promote, alias, push
   main, force push), so the guards hold with either entry point. A
   SessionStart hook runs `git submodule update --remote --merge fgac` when
   the submodule is on main and clean, fail-soft otherwise.
3. **The script stays public and self-sufficient.** `--growth-dir <path>` /
   `GROWTH_DIR` relocate `seen.json`, `digests/`, and the overlay
   `config.json`; the default is still `.growth/`, so a plain clone of this
   repo works with no parent. The digest header stamps the product commit
   (`git rev-parse --short HEAD` of the repo the script ran from) and the
   growth dir, so a digest in the private repo is traceable to the scoring
   rules that produced it.
4. **Overlay, not fork.** `config.json`'s `extra*` arrays are appended to the
   public defaults and deduped; `watchAuthors` (usernames) always surface.
   Public defaults keep evolving here; anything naming a person only ever
   exists in the private repo. Unknown keys warn and are ignored so a typo
   cannot silently drop a source.

## Superseded alternatives

- **Sibling clones + `additionalDirectories`.** Two checkouts side by side
  with the private one added to the product session's directory list. Rejected:
  two roots means two sets of hooks/settings to keep in sync, the product
  session gains write access to the private tree (the wrong direction — the
  private side should read the product, not vice versa), and "which repo am I
  in" becomes a question again.
- **Private directory nested inside the public repo** (a gitignored or
  separately-git-inited `growth/` under this tree). Rejected by Ken as an
  anti-pattern: the private data's safety would rest on an ignore rule inside
  the public repo, every product session would carry it in scope, and a
  submodule pointing the other way (public → private) is exactly the
  reference a public repo must not contain.

## Shipped in this revision

- `scripts/growth-prospects.ts`: `--growth-dir` / `GROWTH_DIR`, overlay
  merge with warnings, `watchAuthors`, commit + growth-dir stamp.
- `docs/growth-prospecting.md` → "Private workspace".
- Merge of `origin/main` into the branch (package.json script list).
- Outside this repo: the `fgac-growth` private repo and its scaffold; the
  `growth-prospects` scheduled task now passes `--growth-dir` and commits the
  digest in the private repo.

## Transitional state

The scheduled task keeps running the script from the existing clone at
`~/GitRepos/fine_grain_access_control` until this PR is merged to main
(the task checks for `--growth-dir` support before running and stops with a
one-line report otherwise). After merge, Ken bootstraps `fgac/` as the
primary clone (`npx vercel link`, `npx vercel env pull .env.local
--environment=development`, `npm run db:branch`) and replaces the old clone
with a symlink `~/GitRepos/fine_grain_access_control → ~/GitRepos/fgac-growth/fgac`
so scheduled tasks and memory notes keep their paths.
