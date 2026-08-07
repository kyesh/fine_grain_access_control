# Connector Growth: Discoverability & First-Run Usability (v2)

Branch: `claude/connector-growth` · Date: 2026-08-07
Revision of v1 recording what actually shipped in the implementation pass and
where it deviates from the v1 design. Phases A–E are implemented on this
branch unless noted.

## Deviations from v1

1. **No OAuth landing/interstitial page (B.4).** The DCR OAuth flow redirects
   straight back to the MCP client after Clerk consent — there is no moment
   we control in that chain (the `/oauth/authorize` interstitial exists only
   for registered partner apps). Onboarding therefore lives on the
   **dashboard recent-connections banner**: "connected with safe defaults"
   summary + one-click **Enable sensitive-mail shield** CTA (reusing the
   existing `applyRecommendedSecurityRules` preset). QA capability 13 A6/A7
   updated to match.
2. **Phases C and D shipped together** (not C-then-D): `request_access`
   reuses the magic-link mint/verify/consume machinery directly, so splitting
   releases bought nothing.
3. **Capability numbering**: parallel work added `11_partner_handoff` and
   `12_push_notifications`, so the planned docs landed as
   `13_default_profile_instant_start`, `14_magic_link_approvals`,
   `15_request_access_tool`.
4. **MCP registry publication prepared, not executed** — publishing to
   registry.modelcontextprotocol.io is an external publication step for the
   user (manifest at `docs/connector_submission/mcp-registry-server.json`).
5. **Phase E baseline already existed** (`mcp_tool_call` events shipped
   separately); this branch added `mcp_connection_created(auto_attached)`,
   `approval_link_minted` / `approval_link_approved`, `shield_enabled`, and
   `read_restriction_enforced` (per-rule-match telemetry that feeds the
   shield default-on revisit from the v1 decision log).

## What shipped

**Phase A — discoverability**
- `listing_copy.md` v2: keyword map + keyword-first tagline
  (`Multiple Gmail accounts & editable Sheets, safely`), rewritten
  description leading with multi-account + editable Sheets, use-cases step as
  four search-phrase clusters, instant-start "what users need first".
- Tool descriptions now carry the multi-account story (`gmail_list`,
  `gmail_read`, `gmail_send` name the `account` parameter and delegated
  inboxes).
- SEO pages: `/use-cases/multiple-gmail-accounts`,
  `/use-cases/google-sheets-agent`, cross-linked from `/docs`.

**Phase B — instant-start**
- Migration `0007`: `proxy_keys.is_default` + `approval_consumptions`.
- `src/db/defaultProfile.ts`: find-or-create the read-only Default Profile
  (own mailbox only; no send whitelist; no Sheets; shield OFF per decision
  log).
- `resolveConnection`: new connections auto-attach `approved` to the Default
  Profile. Pending remains for pre-existing rows and delegation flows; the
  revoked/expired-key liveness check is unchanged.
- Dashboard: recent-connections banner (7-day window) with shield CTA;
  endpoint-card and setup/docs copy updated to instant-start wording.

**Phase C — magic links**
- `src/lib/approvalLinks.ts`: HMAC-signed (key derived from
  CLERK_SECRET_KEY), 15-min expiry, fresh jti per mint; unit-tested in
  `scripts/test-approval-links.ts` (in the `mcp:lint` build gate).
- `approveMagicLink` server action: signature/expiry check → owning-user
  check → key-liveness check → single-use consumption (PK on jti) → grant
  scoped to the requesting key (send whitelist rule with escaped exact
  recipient; sheets rule read-only or read-write).
- `/dashboard/approve`: confirm page showing exactly one grant; RO/RW radio
  for sheet exposure; Clerk-protected route (signed-out → sign-in first).
- Denials that mint links: unauthorized/send-disabled sends (dedicated + raw)
  and sheets not-exposed / read-only-write (dedicated + raw). Explicit sheet
  blocks and Gmail read restrictions never mint links.

**Phase D — request_access**
- New tool (readOnlyHint — it grants nothing): send / sheets_read /
  sheets_write requests mint the same links; malformed or unsupported
  requests are refused with guidance.

**QA inventory** now includes capabilities 13/14/15 and the rewritten 06
(auto-attach lifecycle + key-liveness assertion). Capability 13 A1
(brand-new Google account) is expected to be a documented skip in QA runs
until a disposable fresh-account fixture exists — A9 (second client,
existing user) covers the auto-attach mechanics.

## Revisit triggers (unchanged from v1)

- Shield default-on: revisit when `read_restriction_enforced` telemetry
  shows acceptable precision on real traffic.
- CIMD / Anthropic-held credentials: revisit at directory scale (DCR client
  accumulation).
