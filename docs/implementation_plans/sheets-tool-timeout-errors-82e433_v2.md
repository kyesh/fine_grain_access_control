# Sheets tool-call timeout observability — v2

Branch: `claude/sheets-tool-timeout-errors-82e433`. Extends v1 (see
`sheets-tool-timeout-errors-82e433_v1.md` for the incident investigation and
the 50 s / 15 s rationale) to the proxy path, which v1 listed as a follow-up.

## Changes since v1

1. **Shared helpers extracted** — `src/lib/upstreamTimeouts.ts` now owns
   `GOOGLE_FETCH_TIMEOUT_MS` (50 s), `CLERK_TOKEN_TIMEOUT_MS` (15 s),
   `withTimeout`, and `isUpstreamTimeout`; the MCP route imports them instead
   of defining its own.
2. **Proxy route** (`src/app/api/proxy/[...path]/route.ts`) gets the same
   treatment:
   - New `forwardToGoogle` helper wraps the one Google exchange behind every
     proxy call (sheets, docs, and gmail handlers all route through it) with
     `AbortSignal.timeout(50 s)`. Timeout → HTTP 504 with read-vs-write retry
     guidance; other fetch failures → 502. Both stamp
     `telemetry.errorStatus` (`timeout`/`network`).
   - `fetchClerkGoogleToken` bounded at 15 s; timeout classifies as
     `reason: 'timeout'` on `google_token_fetch_failed` (previously it would
     have surfaced as `clerk_error` — or more likely never fired, because the
     function died first).
   - `proxy_request` gains `google_ms`, `token_ms`, `error_status`, and a
     `timeout` outcome (mapped from 504).
   - **`export const maxDuration = 60`** — the route previously ran at the
     platform default (≤ 15 s), *below* the 50 s bound; without this the
     classified timeout could never fire, and — the pre-existing latent bug —
     any Google call slower than the default died invisibly. The MCP data
     shows real recoveries at 42–59 s, so the proxy was strictly worse off
     than the MCP route until now.
3. Docs: `docs/analytics.md` `proxy_request` row + timeout section extended.

## Validation

- `tsc` / eslint clean on touched files.
- Behavior-preserving on the happy path: `forwardToGoogle` +
  `passthroughResponse` reproduce the previous fetch → text →
  strip-content-encoding → passthrough sequence; the gmail read-rule
  evaluation still sees the raw body/headers/status.
- Post-deploy: `outcome = 'timeout'` and `google_ms` appear on new
  `proxy_request` events.
