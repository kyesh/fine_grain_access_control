# fgac/registry-rename-brand-first — v1

**Goal**: rename the MCP Registry listing from `ai.fgac/google-workspace` to
`ai.fgac/fgac` before any install base exists, and align the pending Smithery
submission (`@fgac/fgac`).

## Why

Google's brand guidelines permit descriptive use of Google trademarks ("for
Google Workspace"; "Gmail, Google Sheets & Docs" in a title) but not a Google
mark as a third party's own product or service name. Directories display the
server ID as the server's name, so `google-workspace` read as the product.
Registries do not enforce this, but FGAC holds a Google-verified OAuth app with
restricted Gmail scopes that is periodically re-reviewed, and a public listing
named after a Google mark is a needless question to invite. Registry names are
immutable, so the rename is a new entry plus retiring the old one — trivial
today (published 2026-09-10T02:32Z, zero installs, Smithery not yet submitted),
costly once an install base splits.

## Changes

- `server.json` name → `ai.fgac/fgac` (title/description unchanged: descriptive).
- `.github/workflows/mcp-registry-publish.yml` search-confirm grep → new name.
- `docs/growth-channels.md`: ledger row, Smithery namespace/ID guidance, naming
  rule + retire command. `listing_copy.md` pointer updated.
- `/.well-known/mcp/server-card.json` picks the new name up automatically
  (derived from `server.json`); it changes on the next production deploy.

## Rollout

1. Merge; `/deploy-prod` (user) so the server card matches.
2. **Retire first, then publish** — the registry enforces one listing per remote
   URL: publishing `ai.fgac/fgac` while `ai.fgac/google-workspace` was active
   failed with "remote URL … is already used by server". Done 2026-09-10 with a
   local `mcp-publisher login http` (same key): `status --status deleted
   ai.fgac/google-workspace 0.1.0`, then `publish server.json` → `ai.fgac/fgac`
   v0.1.0 `active`. The publish action is not needed for this version.
3. Submit Smithery as `@fgac/fgac`.
