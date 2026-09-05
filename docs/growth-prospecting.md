# Growth prospecting (v1)

Tooling for Pillar 3 of the growth strategy
(`docs/implementation_plans/fgac-growth-opportunities_v1.md`): **find** the
conversations and incidents worth a human reply, **measure** whether the
replies convert, and leave the reply itself to Ken. Nothing here posts,
comments, DMs, or emails — automated outreach gets accounts banned and reads
as spam.

```bash
npm run growth:prospects                     # since last run (≥2d, ≤7d), all sources
npm run growth:prospects -- --window 14d     # explicit lookback
npm run growth:prospects -- --sources hn,feeds
npm run growth:prospects -- --dry-run        # don't record anything as seen
npm run growth:prospects -- --print          # echo the digest to stdout too
```

`scripts/growth-prospects.ts` — tsx, no new dependencies, no API keys.

## What it watches

| Source | Endpoint | Queries | Notes |
| --- | --- | --- | --- |
| Hacker News | Algolia `search_by_date`, stories + comments | "claude gmail", "mcp gmail", "chatgpt gmail", "agent email access", "give ai access to my email", "prompt injection gmail/email", "lethal trifecta", competitor names (Gatelet, ScopeGate, AgentPort, Archestra, MCPTotal) | Reliable, unauthenticated, ~1 req/s |
| Reddit | `r/ClaudeAI+mcp+AI_Agents+OpenAI+selfhosted/search` | "connect gmail" / "gmail mcp", "read my email" / "email access", gmail + (claude/mcp/agent) | **Best-effort.** The `.json` endpoint returns 403 to non-browser clients; the `.rss` variant works with an app-style user agent but 429s after one or two calls from the same IP. The script tries JSON, falls back to RSS with 10 s spacing, and on refusal skips the query and says so in the digest's Sources section. Partial Reddit coverage is the expected steady state, not a bug. |
| GitHub | Search API (`is:issue`), unauthenticated or `GITHUB_TOKEN` | New issues on the big Gmail/Workspace MCP servers (`taylorwilsdon/google_workspace_mcp`, `GongRzhe/Gmail-MCP-Server`, `jasonsum/gmail-mcp-server`, `aaronsb/google-workspace-mcp`); free-text "gmail mcp credentials / oauth / credentials.json" | People stuck on `credentials.json` are the ICP mid-pain. Long-tail hits are gated: the issue must be filed by someone other than the repo owner, and gmail/email/inbox/workspace must be in the title or repo name (bodies mention OAuth in passing far too often). Unauthenticated search is 10 req/min, so the four searches are spaced 7 s apart. |
| GitHub star deltas | `GET /repos/{owner}/{repo}` | Gatelet, ScopeGate, AgentPort, Archestra, google_workspace_mcp, Gmail-MCP-Server | Run-over-run delta stored in `.growth/seen.json` |
| Feeds | Atom/RSS | Simon Willison `exfiltration-attacks` (every new item = incident), Simon Willison `prompt-injection`, Embrace The Red (Johann Rehberger), Promptfoo blog | Any new incident item puts **"INCIDENT — write the teardown this week"** at the top of the digest. The last three feeds are filtered by the scoring vocabulary since they also cover non-agent topics. Candidates checked and rejected 2026-09-05: Trail of Bits (too broad), Kai Greshake (inactive since 2023), PromptArmor / Lakera / Zenity / Pillar / Invariant (no working feed URL). |

## Scoring and dedupe

A lead needs the mailbox side (gmail, email, inbox, sheets, docs, drive…) AND
the agent side (claude, mcp, chatgpt, agent, llm…) of the lethal trifecta, or
a competitor name; incidents bypass the check. Score = recency (0–3) +
mailbox terms (≤4) + agent terms (≤2) + pain terms such as credentials/oauth/
scope/prompt injection (≤2) + 3 when both sides are present + 2 for a
competitor mention + 4 for incidents + engagement (HN points/comments) + 2
for issues on the known Gmail MCP servers. Threshold 6; incidents always
show. Obvious noise is dropped by pattern (hiring threads, auto-generated
daily digests, `-bot` authors).

Every surfaced URL is recorded in `.growth/seen.json` so a lead appears in
exactly one digest. `--dry-run` skips the recording. Delete a key from
`seen.json` to resurface a lead.

## Where digests land

`.growth/digests/YYYY-MM-DD.md` (a second run the same day writes
`YYYY-MM-DD-HHMM.md`). The whole `.growth/` tree is gitignored: the repo is
public and a lead list is not for publication. Sections: Incidents /
Reply-worthy threads / Prospects on GitHub / Competitor movement / Sources
(per-source ✓/✗ with the reason, so a silent skip is impossible). Each lead
carries the link, a one-line summary, a suggested angle (factual, 2–3
sentences, keyed off which pain terms matched) and the attribution link to
paste.

## Adding a keyword or source

Everything lives in the CONFIG block at the top of
`scripts/growth-prospects.ts`:

- a phrase → `HN_QUERIES`, `REDDIT_QUERIES`, or `GITHUB_ISSUE_QUERIES`;
- a Gmail MCP server whose issues matter → `GITHUB_GMAIL_MCP_REPOS`
  (its issues then skip the title gate and get the +2 boost);
- a competitor → `COMPETITOR_REPOS` (stars) and `COMPETITOR_TERMS` (mentions);
- a feed → `FEEDS` with `incident: true` when every item is by definition an
  incident, `false` when it needs the vocabulary filter;
- vocabulary → `STRONG_TERMS` / `CONTEXT_TERMS` / `PAIN_TERMS`; `angle()`
  maps pain terms to the suggested angle.

Verify a new feed URL with `curl -sI` first — half the "obvious" feed URLs
for security blogs 404.

## Attribution links

Manual replies carry a `/go/<slug>` link so PostHog's UTM funnel splits by
channel. Rows in the `prospecting` campaign redirect with
`utm_source=<channel>&utm_medium=reply&utm_campaign=prospecting&utm_content=<slug>`
(`src/lib/shortLinkUtm.ts`; flyer rows keep `qr`/`flyer` untouched).

| Slug | Channel | Paste into |
| --- | --- | --- |
| `https://fgac.ai/go/hn` | `hn` | Hacker News comments and submissions |
| `https://fgac.ai/go/rd` | `reddit` | Reddit replies |
| `https://fgac.ai/go/gh` | `github` | GitHub issue comments |
| `https://fgac.ai/go/x` | `x` | X posts (source not automated in v1) |

Create them in production (writes need both flags; run from the main clone
after pulling prod creds to `.secrets/`):

```bash
npx vercel env pull .secrets/prod.env --environment=production
npm run links -- add hn --dest / --campaign prospecting --channel hn --notes "manual replies on Hacker News" --prod --apply
npm run links -- add rd --dest / --campaign prospecting --channel reddit --notes "manual replies on Reddit" --prod --apply
npm run links -- add gh --dest / --campaign prospecting --channel github --notes "manual replies in GitHub issues" --prod --apply
npm run links -- add x --dest / --campaign prospecting --channel x --notes "X posts" --prod --apply
rm .secrets/prod.env
```

The same four commands without `--prod --apply` create them on a local
branch DB. Retarget (never remove) a slug to change its landing page; the
counter survives.

Channel table query (PostHog, HogQL): signups by `utm_source` where
`utm_campaign = 'prospecting'`, joined to `mcp_connection_created` — the same
shape as the flyer funnel in `docs/analytics.md`.

## Manual-reply rules

1. **Participation first.** Answer the question that was asked, fully, as
   if FGAC did not exist. If the thread has no question you can help with,
   do not reply.
2. **Disclose affiliation** every time ("I build FGAC, so discount
   accordingly").
3. **One FGAC mention per thread, maximum**, and only when it is the honest
   answer to something in the thread. Never as the opener.
4. **Never cross-post identical text.** Each reply is written for that
   thread; the digest's "angle" is a hook, not copy.
5. **Be honest about what FGAC would not have stopped** — especially in
   incident teardowns. Analyses front-page; product posts don't.
6. **Use the channel's attribution link**, never a bare `fgac.ai`, so the
   effort is measurable.
7. Competitor threads: only reply when alternatives are asked for; name the
   real distinction (Workspace-specific rules enforced at the proxy, hosted,
   free, open source) without disparaging anyone.

## Schedule

Daily at 06:30 local, as a **local scheduled task** (`growth-prospects`,
`~/.claude/scheduled-tasks/growth-prospects/SKILL.md`) — the same mechanism
as the daily analytics review, so it runs while the Claude desktop app is
open and catches up on next launch otherwise. Daily rather than weekly for
the threads, too: HN and Reddit threads are dead for replying after ~48 h,
and dedupe keeps each daily digest short (a weekly bundle would surface
threads too late to join). The incident feeds are checked on every run.

The task runs one command from the main clone and reports the digest's
headline counts plus any degraded source:

```bash
npm run growth:prospects -- --print
```

If the task is missing (new machine, or it was deleted), recreate it with
the `scheduled-tasks` MCP in a Claude Code session, or run the command by
hand — the script is self-contained and the state file makes catch-up
runs safe.

## Human checklist

- [ ] Create the four production slugs (commands above) — the script does
      not touch the database.
- [ ] Optional: export `GITHUB_TOKEN` (a fine-grained token with no
      permissions is enough) in the shell that runs the task; it lifts
      search from 10 to 30 req/min and lets more free-text queries be added.
- [ ] Confirm the `growth-prospects` scheduled task exists on the machine
      that stays open in the morning; otherwise create it.
- [ ] After the first two weeks: prune keywords that only produce noise,
      raise `MIN_SCORE` if the digest is too long, and add the PostHog
      channel table to the daily analytics review.

## Out of scope for v1 (follow-ups)

- **Google Sheet outreach tracker** through FGAC's own connector
  (lead URL / channel / state found→replied→converted / digest date) —
  dogfooding and demo material; the script could append candidate rows via
  `sheets_append_rows`.
- **X/Twitter** as a source (needs authenticated access; the `twitter-digest`
  skill's Chrome-driven approach is the likely shape).
- **Auto-drafted replies.** Deliberately not built: the value is in Ken's
  voice, and drafted text invites cross-posting.
- Reddit reliability: an OAuth app registration (script-type, read-only)
  would make the JSON endpoint dependable; skipped in v1 to stay keyless.
