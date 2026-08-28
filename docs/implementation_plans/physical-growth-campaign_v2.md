# Physical Growth Campaign — Site Changes & QR Tracking (v2)

Branch: `claude/physical-growth-campaign-33d0cb` · supersedes v1

Changes from v1: Part 2 (QR tracking) is now IMPLEMENTED, not just designed,
with two deltas from the v1 design; and a fourth directory-link surface was
added on the dashboard.

## Part 1 addendum — dashboard connect path (shipped)

`McpConnectCard` ("Connect a new agent via MCP", `AgentProfilesView.tsx`) now
carries a footer line linking claude.ai users to the directory listing —
`DirectoryCta` gained the `dashboard_connect` location. Rationale: users who
reach the dashboard before wiring an agent were only offered the
endpoint+token path; the directory is the simpler route for claude.ai.

## Part 2 — QR / short-link tracking (shipped)

As designed in v1, with two deltas:

1. **No admin UI, a CLI instead.** `scripts/short-links.ts`
   (`npm run links -- list|add|retarget|remove`) manages slugs — designed for
   ongoing slug additions over time. Local runs target the branch DB via
   `.env.local`; production requires `--prod` (reads `.secrets/prod.env` by
   name) and refuses writes without `--apply`, per the repo's
   production-credentials rules. `retarget` repoints a printed QR without
   losing its counter.
2. **Relative destinations resolve against the request origin**, not a
   hardcoded host, so the same rows work on localhost, previews, and
   production.

Shipped pieces:

- `src/db/schema.ts` — `short_links` table (slug PK, destination, campaign,
  variant, channel, notes, scan_count, last_scanned_at, created_at); no
  per-scan PII columns by design. Migration `0011_short_links.sql`
  (journal tag renamed to match), applied to the isolated branch.
- `src/app/go/[slug]/route.ts` — public GET: slug lookup (lowercased), bot
  user-agent filter, server-side `flyer_scanned` capture (random UUID
  distinct id, device class, Vercel geo headers, `$geoip_disable`), counter
  bump deferred via `after()`, single 302 with
  `utm_source=qr&utm_medium=flyer&utm_campaign=<campaign>&utm_content=<slug>&ref=<slug>`.
  Unknown slug → 302 to `/` (event still fires with `slug_known: false` to
  surface typos/decay). A DB failure never eats the redirect.
- `docs/analytics.md` — `flyer_scanned` cataloged; `directory_link_clicked`
  gains `dashboard_connect`.

Funnel: `flyer_scanned` → `$pageview` (auto-captured `$utm_*`) →
`sign_up_started` → `sign_up_completed` → `mcp_connection_created`; compare
scan→visit and visit→connect as separate stages (cross-device breaks the
chain at the pageview).

Out of scope, deliberately: dashboard UI for links (CLI is right-sized for
tens of slugs), `ref` persistence to localStorage for cross-visit credit
(worth adding if scan→signup gaps look large), and any per-scan Postgres
event table (PostHog holds per-scan detail).
