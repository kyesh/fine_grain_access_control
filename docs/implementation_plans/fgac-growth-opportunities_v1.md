# FGAC.ai Growth Strategy (v1)

Branch: `claude/fgac-growth-opportunities-e8acc9` · Date: 2026-09-04
Research basis: three web-research passes (Product Hunt outcomes, MCP distribution
surfaces, community channels) + PostHog funnel data, 2026-09-01.

## Where we stand (data)

- **Only proven channel**: Claude connector directory. Launch week (2026-08-16):
  136 signups → 32 → 12. A decaying spike, not a steady stream.
- **Retention is good**: weekly active tool users 47 → 62 → 38 (partial week);
  85 distinct people called tools in the trailing 14 days. Acquisition, not
  activation, is the bottleneck.
- **Flyer/QR campaign**: 22 scans, 0 attributed signups yet (cross-device breaks
  attribution; early).
- **Strategic read**: repeat the directory playbook on every equivalent surface,
  and build channels that refill the top of funnel between launches.

## Positioning (use everywhere, verbatim-ish)

The "AI agent permission gateway" category got crowded in 2026 (Gatelet,
ScopeGate, AgentPort, Archestra…) and generic gateway launches flop (multiple
1–8-point Show HNs). FGAC's defensible frame:

> Hosted + free · Google-Workspace-specific rules (per-label, per-recipient,
> per-file — not generic tool gating) · enforced at the proxy, not in the
> prompt (survives context compaction and prompt injection) · open source, so
> "read the enforcement code" answers the trust objection.

Lead with the fear, not the category: *"Give Claude your Gmail without giving
it your Gmail."* List under **security/access-control** categories, where we
are nearly alone, not only under Gmail/productivity.

## Pillar 1 — MCP distribution fan-out (highest leverage-per-hour)

### 1a. Official MCP Registry (registry.modelcontextprotocol.io) — do first

Publishing here propagates automatically into the **GitHub MCP Registry**,
which VS Code / Copilot / Copilot CLI consume directly (`/mcp search`). One
publish, two registries, the largest dev install surface. Mechanics verified
against the official docs (2026-09-04):

1. **`server.json`** (remote server — no npm package needed):

   ```json
   {
     "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
     "name": "ai.fgac/google-workspace",
     "title": "FGAC.ai — Safe Gmail, Sheets & Docs for AI agents",
     "description": "…keyword-first copy per connector-growth_v1 Phase A…",
     "version": "<app version>",
     "remotes": [{ "type": "streamable-http", "url": "https://fgac.ai/api/mcp" }]
   }
   ```

2. **Auth = namespace.** Two options:
   - `mcp-publisher login github` → names must be `io.github.kyesh/*` (fastest).
   - **HTTP domain auth (recommended)** → names `ai.fgac/*`: generate an
     Ed25519 keypair, serve `v=MCPv1; k=ed25519; p=<pubkey>` at
     `https://fgac.ai/.well-known/mcp-registry-auth`, then
     `mcp-publisher login http --domain fgac.ai --private-key …`. We already
     serve `.well-known` routes from Next.js, so this is a tiny route + a
     secret. DNS TXT (`v=MCPv1; k=ed25519; p=…` on fgac.ai) is the equivalent
     alternative if we prefer DNS.
3. `mcp-publisher publish`, verify via
   `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=ai.fgac"`.

Build-out: check `server.json` + the well-known route into the repo; private
key in Vercel env; optional GitHub Action to republish on version bump.
Registry is in preview — expect occasional breaking changes/resets; a
republish action makes resets a non-event. Effort: ~half a day including the
route.

### 1b. Smithery (smithery.ai) — do same day

- Submit at **smithery.ai/new** with the public HTTPS URL
  `https://fgac.ai/api/mcp`. Requirements: streamable HTTP (have it) + OAuth
  (have it, Clerk DCR).
- Caveat: Smithery's auto-scan registers clients via **Client ID Metadata
  Documents (CIMD)**, the 2026-07-28 spec direction; our Clerk flow is DCR. If
  the scan fails on that, the documented bypass is hosting static metadata at
  `https://fgac.ai/.well-known/mcp/server-card.json`. Budget an hour for that
  fallback.
- Listings show live call volume / success rate / uptime — public social
  proof. Free for externally-hosted servers (their paid tier was hosting,
  discontinued for new servers Mar 2026).

### 1c. The rest of the fan-out (batch, one afternoon)

Cline marketplace (GitHub issue + 400×400 logo + agent-installable README),
Docker MCP Catalog remote-OAuth section (PR to docker/mcp-registry), PulseMCP
(submit + pitch the newsletter a use-case writeup), Glama claim
(`/.well-known/glama.json`), mcp.so, awesome-mcp-servers via
mcpservers.org/submit.

### 1d. ChatGPT — submit now, harvest later

Plugin directory review runs 60–120 days → submit ASAP for option value; frame
as an *access-control product* using user-authorized Google OAuth (never
"unofficial Gmail for ChatGPT" — that's a policy rejection). Meanwhile ship a
first-class **ChatGPT developer-mode setup guide** page; that path works today
with zero review.

### 1e. Product Hunt — deliberate, deferred

Verdict from measured 2025–26 outcomes: featured launches convert 1–3%;
honest solo-founder base case ≈ 300–2,000 visitors, 15–60 signups, dead by
day 3; durable value = DA-91 backlink + category presence next to
MCPTotal/Composio. Do it once, ~1 week ceiling, Tuesday launch (or weekend for
an easy badge), no hunter needed, line up existing users for the first 4
hours. **Precondition**: onboarding converts a cold skeptical visitor in one
sitting (connector-growth Phase B default-attach work is exactly this).
Relaunch allowed after ~6 months, so deferring costs nothing.

## Pillar 2 — Incident-cycle content (ongoing, compounding)

Each prompt-injection/agent-overreach incident is a free distribution event
(2026 examples: the lethal-trifecta cluster; the Meta researcher whose agent
deleted 200+ emails after context compaction stripped its safety prompt —
literally our pitch). Play: same-week technical teardown, honest about what
FGAC would NOT have stopped; submit to HN as analysis (analyses front-page
where product launches don't), post to r/cybersecurity + X.

Adjacent: two SEO gap pages (nothing ranking for "connect Gmail to Claude
safely" answers *limiting what the agent can do once connected*; plus an
official-connector vs MCP-servers vs rule-enforced-proxy comparison) — this is
connector-growth_v1 Phase A item 4, upgraded. Then a rigorous lethal-trifecta
architecture post → no-ask outreach to Simon Willison (his stated preferred
mitigation is deterministic policy engines outside the model) and PromptArmor
(offer FGAC as an exfiltration test target).

## Pillar 3 — Manual prospecting, tooled

Manual outreach (Ken replying as a human) is the right mode — automated
posting gets banned and reads as spam. The tooling opportunity is **finding
the conversations and measuring the outcome**, not automating the touch:

1. **Prospect digest (build: `scripts/growth-prospects.ts` + scheduled task)**
   — follows the analytics-review/twitter-digest pattern. Free, keyless
   sources:
   - HN Algolia API (`hn.algolia.com/api/v1/search_by_date`) for keyword
     clusters: "claude gmail", "mcp gmail", "agent email", "prompt injection
     gmail", competitor names.
   - Reddit JSON search (r/ClaudeAI, r/mcp, r/AI_Agents, r/OpenAI):
     "connect gmail", "email access", "claude read my email".
   - GitHub search API: new issues on gmail-mcp-server repos (people stuck on
     credentials.json ARE our ICP mid-pain), new awesome-mcp PRs, star
     velocity on competitors.
   - Willison's exfiltration-attacks tag + key security feeds (RSS) → flags
     "incident: write the teardown this week".
   Output: dated markdown digest (leads + one-line suggested angle each +
   dedupe against previously-surfaced links). Ken replies manually.
2. **Attribution slugs** — the `npm run links` CLI already exists for QR
   tracking. Mint per-channel slugs (`/go/hn`, `/go/rd`, `/go/x`,
   `/go/gh-readme`, `/go/ph`) so every manual reply and README link carries
   `utm_source`; the flyer funnel dashboards then work for every channel.
3. **Prospect/outreach tracker** — a Google Sheet driven through FGAC's own
   connector (dogfooding = demo material): columns for lead URL, channel,
   state (found/replied/converted), digest date. The digest script can append
   candidate rows via our own `sheets_append_rows`.
4. **Delegation as a growth loop (product)** — `email_delegations` requires
   the delegate to sign up: our only built-in invite mechanic. Instrument
   delegation-driven signups (`delegation_created` → invitee
   `sign_up_completed`), then nudge: "working with an assistant/teammate?
   Delegate an inbox." Measure before promoting it.

## Measurement & cadence

- Weekly: channel table in the existing analytics review (signups by
  utm_source/slug, connection rate, week-2 retention per cohort).
- Every listing/submission gets a dated row in a `docs/growth-channels.md`
  ledger (surface, date, link, status) so we know what's live where.
- Success bar for the quarter: ≥2 channels besides the Claude directory each
  driving ≥10 signups/week, with week-2 tool-user retention ≥ the directory
  cohort's.

## Sequencing

| Week | Work |
|---|---|
| 1 | 1a registry publish (+ well-known route) · 1b Smithery · start 1d ChatGPT submission + dev-mode guide |
| 1–2 | 1c directory batch · attribution slugs (P3.2) · prospect digest v1 (P3.1) |
| 2–3 | SEO gap pages · ChatGPT dev-mode guide live · tracker sheet (P3.3) |
| 3–4 | Lethal-trifecta post → Willison/PromptArmor outreach · delegation loop instrumentation (P3.4) |
| on trigger | Incident teardowns, same week as each incident |
| after onboarding Phase B ships | Product Hunt (Tuesday), users lined up for hour 1 |
