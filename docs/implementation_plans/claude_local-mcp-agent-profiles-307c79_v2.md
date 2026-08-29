# Profile-Addressed MCP URLs — Implementation Plan v2

Branch: `claude/local-mcp-agent-profiles-307c79`
Status: spike validated end-to-end (2026-08-28); strategy pending final agreement.

## Goal

Let the MCP connection URL identify which agent profile a new connection binds to:
`https://fgac.ai/api/mcp/<profile-slug>`. Setup instructions copied from a specific
profile then implicitly map the agent to that profile — no dashboard rebinding step.

## Decisions (from discussion 2026-08-28)

1. **Path-based URLs**, not subdomains. `fgac.ai` DNS is on Cloudflare nameservers;
   Vercel only auto-issues wildcard certs for domains on Vercel nameservers, so
   `<slug>.agent.fgac.ai` would force a DNS migration. Paths need zero infra change,
   and slugs become per-user (no global namespace).
2. **Creation-time binding only.** The slug maps the OAuth client's connection to a
   profile when the connection is first created. Requests arriving later on a
   different profile's URL never rebind; the dashboard remains the way to rebind.
3. **Readable slugs** derived from the profile label (`slugifyProfileLabel`:
   lowercase, non-alphanumerics → `-`). Lookup is always scoped to the
   authenticated user, so slugs need only per-user uniqueness.
4. Bare `/api/mcp` is unchanged (binds to Default Profile as today).

## Mechanism (validated in the spike, commit 406c4c1)

- `src/middleware.ts` rewrites `/api/mcp/<slug>` → `/api/mcp`, carrying the slug in
  the `x-fgac-profile-slug` request header. Slug pattern: `[a-z0-9](:?[a-z0-9-]*[a-z0-9])?`, ≤64 chars.
- `src/app/.well-known/oauth-protected-resource/mcp/[slug]/route.ts` serves per-slug
  RFC 9728 metadata with `resource: ${origin}/api/mcp/<slug>` (Claude requires the
  resource to match the connection URL exactly).
- `src/app/api/mcp/route.ts`:
  - export wrapper `withProfileResourceMetadata` (a) normalizes `req.url` back to
    `/api/mcp` — after a middleware rewrite the handler still sees the original
    external URL and `mcp-handler` 404s on exact-path mismatch — and (b) patches the
    401 `WWW-Authenticate` `resource_metadata` pointer to the per-slug document;
  - `verifyMcpAuth` reads the header, stashes `profileSlug` in `authInfo.extra`,
    passes it to `resolveConnection`;
  - `resolveConnection` binds a NEW connection to the caller's live profile whose
    slugified label matches; unknown slug → default profile (graceful degrade);
    `mcp_connection_created` now carries `profile_slug` / `profile_slug_matched`.

### Spike evidence (local dev server + real Claude Code 2.1.220)

- Claude Code performed path-aware discovery and sent
  `resource=http://localhost:61385/api/mcp/production-qa-agent` in the authorize
  request (2025-06-18 MCP auth spec behavior).
- Entry `fgac-spike2` → `/api/mcp/all-access` → connection bound to profile
  "All Access". Entry `fgac-spike` → unknown slug → Default Profile. Both fully
  connected (`claude mcp list` ✔) and neither rebound on reconnect.
- Each Claude Code server entry registers its own DCR OAuth client (credentials are
  keyed per entry name in Claude Code's store), so several entries against the same
  origin map cleanly to several profiles.


### Same entry name across projects (tested 2026-08-29)

The recommended setup uses ONE canonical entry name (`fgac`) in every project, with
only the URL varying per profile. Verified with two scratch projects, both entries
named `fgac-same`, pointing at `/api/mcp/all-access` and `/api/mcp/default-profile`:

- Claude Code scopes local-config MCP OAuth per project — proj-b required its own
  login while proj-a stayed connected; no token sharing, no clobbering.
- Each ran its own DCR (clients `DpK7…`, `0ZNE…`) and bound to its URL's profile
  ("All Access" / "Default Profile"), both `✔ Connected` simultaneously.

So setup instructions can say: always call the server `fgac`; the URL you copy from
your profile decides which profile the agent gets.

## Remaining work (proposed)

1. **Hardening**
   - Slug collisions: two labels can slugify identically ("Research Bot" /
     "research-bot"). Decide: block at profile create/rename, or deterministic pick
     (oldest) + dashboard warning.
   - Serve the RFC 9728 path-insertion probe location
     `/.well-known/oauth-protected-resource/api/mcp/<slug>` as well (belt-and-braces
     for clients that ignore the explicit header).
   - Unit tests: slugify, middleware rewrite, PRM route, binding + fallback,
     no-rebind, 401 header patch.
2. **Dashboard** — per-profile connect card (`AgentProfilesView` / `McpConnectCard`):
   show the profile's URL and a copyable `claude mcp add` command; surface which URL
   a connection arrived on.
3. **Setup instructions** — extend `/setup` and add a guide page for local
   project-scoped MCP in Claude Code (Desktop): `.mcp.json` example, per-profile URL,
   the new-session-before-`/mcp` quirk, `claude mcp add` + `claude mcp login` path.
4. **QA** — extend the relevant capability docs with profile-addressed URL
   assertions; run `/qa-claude-code` scoped to them.

## Known risks / notes

- **CIMD**: Claude Code prefers a published client-identity document over DCR when
  the AS supports it. Clerk doesn't today; if it ever does, distinct entries could
  share one `client_id` and the `(user_id, client_id)` uniqueness on
  `agent_connections` would collapse entries. URL-addressing mitigates (the slug
  still differentiates at creation), but rebinding semantics would need a revisit.
- Older MCP clients (2025-03-26 spec) discard the path for auth discovery; they
  still authenticate via the root AS metadata and simply omit `resource`. Binding
  works regardless (it keys off the request URL, not the token).
- Dev-branch DBs contain multiple `users` rows per email from older Clerk
  instances; profiles hanging off stale rows are invisible to slug lookup (observed
  with `Production-QA-Agent` in the spike). Production has a single live instance.
