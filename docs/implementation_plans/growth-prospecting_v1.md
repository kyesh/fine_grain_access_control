# Growth prospecting automation — v1

Branch: `claude/growth-prospecting` · Date: 2026-09-05 · Implements Pillar 3
items 1–2 of `fgac-growth-opportunities_v1.md`.

## Goal

A script plus schedule that **finds** conversations and incidents worth a
manual, human reply and hands Ken a dated digest with a suggested angle and
an attribution link per lead. It never posts, comments, DMs, or emails —
finding and measuring are automated, the touch stays human.

## Design decisions

1. **Keyless sources only, no new dependencies.** HN Algolia, Reddit public
   search, GitHub search (optional `GITHUB_TOKEN`), and four Atom/RSS feeds,
   fetched with Node 22's global `fetch` and a hand-rolled feed reader. Each
   source is wrapped so a failure degrades to a ✗ line in the digest's
   Sources section rather than aborting the run.
2. **Reddit is best-effort by construction.** Measured 2026-09-05: the
   `.json` search endpoint returns 403 to every non-browser client tried
   (generic UA, browser UA, app-style UA, `api.reddit.com`, `old.reddit.com`
   → login redirect); the `.rss` variant returns 200 with an app-style UA
   but 429s on the next call within ~15 s. The script tries JSON, falls back
   to RSS with 10 s pacing and one Retry-After-aware retry, and skips the
   query on refusal. One multi-subreddit request per phrase keeps the call
   count at three. A read-only Reddit OAuth app would fix this; deferred to
   stay keyless in v1.
3. **GitHub free-text hits are gated hard.** The first run surfaced ~40
   "prospects" that were people's own planning issues in unrelated repos
   whose bodies mention gmail/oauth in passing (agent-written issues are
   long). v1 rule: outside the known Gmail/Workspace MCP servers, the filer
   must not be the repo owner and gmail/email/inbox/workspace must appear in
   the title or repo name.
4. **Scoring is product-specific, not keyword-count.** A lead needs the
   mailbox side AND the agent side of the trifecta, and the mailbox must be
   either product-specific (gmail/inbox/google workspace/google account) or
   the subject of the thread (title hit). Generic "email" inside an unrelated
   HN comment was the dominant noise in run 2 (42 "threads", roughly half
   junk). Threshold 9 after re-weighting; incidents always show.
5. **Attribution reuses the short-link table.** Slugs `hn`, `rd`, `gh`, `x`
   in campaign `prospecting`. The `/go` route hardcoded
   `utm_source=qr&utm_medium=flyer`; it now derives both from the row via
   `src/lib/shortLinkUtm.ts` — `<channel>`/`reply` for `prospecting`, the
   historical `qr`/`flyer` for everything else (tested in
   `scripts/test-short-link-utm.ts`, part of `mcp:lint`). The event name
   `flyer_scanned` is kept so existing dashboards keep working.
6. **Daily cadence, one task.** Ken's brief suggested weekly for threads and
   daily for incidents. Chosen: daily for both, because HN/Reddit threads are
   dead for replying after ~48 h and dedupe keeps each daily digest short;
   the default window is "since last run, min 2 d, max 7 d". Wired as a local
   scheduled task (`growth-prospects`, 06:30) — the same mechanism as the
   analytics review and Neon pruner — so it runs while the desktop app is
   open. The command is allowlisted in `.claude/settings.json` so the headless
   run does not stall on a permission prompt.
7. **State is local and gitignored.** `.growth/seen.json` (surfaced URLs,
   star counts, last run) and `.growth/digests/`. The repo is public; a lead
   list with usernames is not for publication.

## Shipped

- `scripts/growth-prospects.ts` (`npm run growth:prospects`)
- `src/lib/shortLinkUtm.ts`, `scripts/test-short-link-utm.ts`, `/go` route change
- `docs/growth-prospecting.md` (sources, scoring, slugs, reply rules, schedule, checklist)
- `docs/analytics.md` — `flyer_scanned` row notes the prospecting attribution
- `.claude/settings.json` allow entry; `.gitignore` `.growth/`
- Local scheduled task `growth-prospects` (created from the session; prompt
  reproduced in `docs/growth-prospecting.md`)

## Left for Ken (human checklist)

- Production slugs: the four `npm run links -- add … --prod --apply` commands
  in `docs/growth-prospecting.md`. Not run by the agent (production write).
- Optional `GITHUB_TOKEN` in the task's shell.
- Confirm the scheduled task exists on the machine that is open in the
  morning (it was created on the machine this branch was built on).

## Out of scope (follow-ups)

Google Sheet outreach tracker via FGAC's own connector; X/Twitter as a
source; auto-drafted replies (deliberately not); Reddit OAuth app for a
dependable JSON endpoint.
