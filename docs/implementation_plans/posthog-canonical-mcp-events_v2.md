# PostHog tracking improvements — v2 (extends v1)

Branch: `claude/gifted-bhaskara-861ce8` (merged origin/main 2216bd2, which added
the Descript demo video embeds this revision instruments).

## Scope added since v1

1. **Video play tracking** (`src/components/TrackedVideoEmbed.tsx`): the three
   Descript demo iframes (home ×2, multi-Gmail use-case ×1) are wrapped in a
   client component that captures `video_played` (`video_id`, `video_title`,
   `page`) once per mount. Mechanism: Descript embeds implement the player.js
   (Embedly) protocol and also post a bare `descript:embed:played` string on
   play — verified empirically with a local probe page, and end-to-end in dev
   (event arrived in PostHog with correct properties; the two play
   notifications dedupe to one event).
2. **QA capability 16 A7**: video play assertion + runbook steps in all 8
   agent/production runbooks (console-postMessage fallback documented for
   embeds that ignore automated clicks).
3. **Self-driving setup** (via the authenticated PostHog MCP; the
   `npx @posthog/wizard self-driving` route was blocked by the session's
   permission layer — it bundles its own autonomous coding agent — and the
   wizard also requires Node ≥22.22, now installed at `~/local/node22.23`):
   - Project already enrolled in scouts early access (100 runs/day).
   - Signal source enabled: `analytics` / `anomaly_investigation`.
   - Signal source deliberately left for the user: `session_replay` /
     `session_analysis_cluster` (AI reads session recordings — privacy call).
   - Two scouts prepared (pending user "confirm"):
     `signals-scout-mcp-usage-watchdog` (traffic/outcome/schema regressions on
     `$mcp_tool_call`, incl. fresh legacy-named events) and
     `signals-scout-signup-funnel` (conversion, CTA mix, `video_played`
     engagement, instrumentation sanity). Both report aggregates only, never
     person-level identifiers.
   - GitHub integration for scout-drafted PRs: user action in the PostHog UI.

## Validation

- `tsc --noEmit` + eslint clean on changed files.
- `video_played` verified live: dev server → play → event in PostHog
  (`environment=development`, page `/`, one event despite two play messages).
- Full env bootstrap done in this worktree (vercel link/pull, db:branch on
  `claude-gifted-bhaskara-861ce8`).
- Remaining: preview validation via /deploy-pr-preview; production events
  appear after merge + deploy.
