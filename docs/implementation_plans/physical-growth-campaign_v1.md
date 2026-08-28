# Physical Growth Campaign — Site Changes & QR Tracking Design (v1)

Branch: `claude/physical-growth-campaign-33d0cb`

Scope note: this document covers the **code** side of the campaign prep — the
Claude-directory links (shipped in this revision) and the design for the
QR/short-link tracking system (not yet implemented). Campaign strategy
(campus targets, flyer copy, channel plans) deliberately lives outside this
public repo.

## Part 1 — Claude connectors directory links (SHIPPED)

FGAC.ai is listed at `https://claude.ai/directory/fgac-ai`. Before this
change, nothing user-facing mentioned the directory, and the setup guide
only documented URL-paste installs (Claude Code / Cursor / Windsurf /
Claude Desktop) — even though the directory listing is the lowest-friction
install path for claude.ai users (web, desktop, and mobile).

Changes:

1. **`src/app/DirectoryCta.tsx`** (new) — tracked outbound link to the
   listing. Captures `directory_link_clicked` with
   `cta_location: announcement_bar | setup_step1 | docs_support`.
   Mirrors the `SignUpCta` pattern.
2. **`src/app/layout.tsx`** — site-wide announcement bar above the nav:
   "New — FGAC.ai is now available in the Claude connectors directory →".
3. **`src/app/setup/page.tsx`** — new first card in Step 1:
   "Claude.ai — web, desktop & mobile" (badged *Easiest*), linking to the
   listing; metadata description updated.
4. **`src/app/docs/page.tsx`** — directory link in the Support section
   (the docs page is the listing's Documentation URL, so this closes the
   loop both ways).
5. **`docs/analytics.md`** — `directory_link_clicked` added to the event
   catalog.

Wording constraint (researched 2026-08-27): Anthropic publishes **no
badge/logo program** for directory-listed connectors, and the Software
Directory Terms prohibit statements suggesting partnership, sponsorship, or
endorsement. All copy is therefore descriptive ("available in the Claude
connectors directory") with no Anthropic marks — the same pattern used by
other listed companies (Pipedrive, Harness, SiftedAI).

Funnel: `directory_link_clicked` → (claude.ai, unobservable) →
`mcp_connection_created` (fires when the directory's Connect flow completes
our OAuth).

## Part 2 — QR / short-link tracking (DESIGN — build next)

Goal: per-flyer-variant scan tracking and downstream conversion attribution
for physical QR campaigns, with the ability to point different variants at
different destinations (directory listing vs. landing page vs. video).

Decision: **build in-house** on the existing stack rather than Bitly/Dub/
Short.io. Rationale: zero incremental cost on the current Vercel plan;
`fgac.ai/go/x` reads more trustworthy than `bit.ly/x` in the iOS camera
preview; short slugs keep the QR sparse (better print robustness); server-
side capture is immune to ad-blockers; Vercel injects coarse geo headers
for free; Bitly free has no analytics, Dub free caps at 1k events/mo with
30-day retention, and Dub self-host needs ~5 external services.

### Route

`src/app/go/[slug]/route.ts` — public GET (middleware already only protects
`/dashboard`):

1. Look up slug in `short_links`. Unknown slug → 302 to `/`.
2. Bot filter on user-agent (link-preview crawlers: iMessage, WhatsApp,
   Slack, facebookexternalhit, bots ~5–10% of QR traffic). Bots get the
   redirect but no analytics event.
3. Fire `flyer_scanned` via `captureServerEvent` (distinctId = random UUID)
   with `slug`, `campaign`, `variant`, `channel`, `destination_kind`,
   device class parsed from UA (no raw UA/IP stored — consistent with the
   schema's no-PII convention), `geo_city`/`geo_country` from
   `x-vercel-ip-city`/`-country`.
4. 302 to the destination with appended params:
   `?utm_source=qr&utm_medium=flyer&utm_campaign=<campaign>&utm_content=<slug>&ref=<slug>`.
   Exactly one hop — no stacked redirects.

### Schema (Drizzle, follows `approvalRequests` shape)

```
short_links:  slug (text PK), destination (text), campaign, variant,
              channel, notes, createdAt, scanCount (integer),
              lastScannedAt
```

Per-scan detail beyond the counter lives in PostHog (`flyer_scanned`), not
Postgres — avoids a PII-bearing event table and keeps the migration tiny.
Admin creation: seed script or ad-hoc insert; a dashboard page is not
worth building for tens of links. Reminder: `npm run db:branch` before
`db:generate`; verify the `NNNN_*.sql` migration lands and
`npm run db:migrate` passes (CLAUDE.md DB rules 1, 8).

### Attribution chain

`flyer_scanned` (server) → `$pageview` with `utm_*`/`ref` (PostHog client
auto-captures `$utm_*`) → `sign_up_started` → `sign_up_completed` →
`mcp_connection_created`. For cross-device drop-off (scan on phone, install
on laptop) treat scan→pageview and pageview→connection as separate funnel
stages; a `ref` param persisted to localStorage and attached via
`posthog.register` closes the loop for same-device conversion.

### QR production notes

- Error correction M (or H only if a logo overlays the code, then +30% size)
- ≥1.5 in (comfortable 2–2.5 in) printed side for 1–2 ft scan distance
  (10:1 distance rule), 300 DPI, ≥4-module quiet zone, dark-on-light
- One slug per (variant × location); destination editable in the DB so a
  printed QR can be re-pointed without reprinting

New events to add to `docs/analytics.md` when built: `flyer_scanned`.
