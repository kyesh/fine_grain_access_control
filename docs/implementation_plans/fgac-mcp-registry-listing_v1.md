# fgac/mcp-registry-listing — v1

**Goal**: list FGAC's hosted MCP server in the official MCP Registry
(registry.modelcontextprotocol.io, mirrored by the GitHub MCP Registry) and
Smithery, automating everything that can be automated and leaving a precise
human checklist for the rest.

**Verified against** modelcontextprotocol.io/registry/{quickstart,
remote-servers, authentication, github-actions} and smithery.ai/docs/build/publish
on 2026-09-05.

## Decisions

1. **Domain-based auth (HTTP method), namespace `ai.fgac/*`** — preferred over
   `io.github.kyesh/*`: the name survives repo moves and reads as the product.
   HTTP over DNS because the well-known route ships in the same deploy as
   everything else and needs no DNS console access.
2. **Server name `ai.fgac/google-workspace`** — replaces the earlier draft
   `ai.fgac/fgac` in `docs/connector_submission/mcp-registry-server.json`
   (deleted; `server.json` at the repo root is the single manifest, where
   `mcp-publisher publish` expects it). "google-workspace" describes the
   surface; the org half of the name already says FGAC.
3. **Version tracks `package.json`** (`0.1.0`), enforced by
   `scripts/test-server-json.ts` in `npm run mcp:lint`. The registry refuses
   duplicate versions, so a republish is a version bump in both files.
4. **Description ≤ 100 chars is a hard schema limit** — keyword-first:
   "Multiple Gmail accounts, editable Google Sheets & Docs for AI agents.
   Deny-by-default access rules."
5. **Smithery server card built at request time** from `server.json` +
   `TOOL_DEFS` rather than a checked-in JSON — it cannot drift from the tool
   catalogue. Input schemas live inline with the zod registrations in
   `route.ts` and are not duplicated; the card advertises object-input tools
   and points at the live endpoint.
6. **Publish workflow is `workflow_dispatch` only** (not tag-triggered): the
   registry is in preview and may reset; publishing is a deliberate act tied
   to a production deploy, not to every tag.
7. **The private key never enters the repo or a Vercel env.** It lives in
   `.secrets/` (gitignored, verified before generation) and in one GitHub
   Actions secret. The public record is hardcoded in the route — it is the
   verifier, not the secret.

## Files

- `server.json` — registry manifest (2025-12-11 schema, remote-only).
- `src/app/.well-known/mcp-registry-auth/route.ts` — text/plain domain proof.
- `src/app/.well-known/mcp/server-card.json/route.ts` — Smithery fallback card.
- `public/.well-known/glama.json`, `public/logo-400.png` — optional-channel assets.
- `.github/workflows/mcp-registry-publish.yml` — one-click (re)publish.
- `scripts/test-server-json.ts` — manifest invariants, wired into `mcp:lint`.
- `docs/growth-channels.md` — ledger + human checklist.
- `docs/QA_Acceptance_Test/production/00_smoke_test.md` — two new discovery curls.

## Human steps (see docs/growth-channels.md for exact commands)

1. Back up `.secrets/mcp-registry-key.pem` to 1Password.
2. Add GitHub secret `MCP_PUBLISHER_PRIVATE_KEY` (raw hex).
3. Merge + `/deploy-prod`.
4. Run the **MCP Registry Publish** action (or `mcp-publisher` locally); verify via the search API.
5. Submit `https://fgac.ai/api/mcp` at smithery.ai/new.
6. Optional: Cline, PulseMCP, Glama, mcpservers.org.
