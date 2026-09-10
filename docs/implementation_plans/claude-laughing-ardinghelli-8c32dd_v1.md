# MCP 2026-07-28 `server/discover` probes — classify, don't migrate (yet) — v1

Branch: `claude/laughing-ardinghelli-8c32dd`. Source: the 2026-09-04 analytics
review, which found that the `mcp_transport_rejected` event (PR #114, deployed
~02:45Z) was 100% claude.ai clients probing with `server/discover` under
`MCP-Protocol-Version: 2026-07-28`, taking our SDK 1.x 400, and falling back to
`initialize` — while the runbook read every such row as "user silently broken".

## Established before building

### 1. What the spec says (verified against modelcontextprotocol.io, 2026-07-28 revision)

- `server/discover` is the modern handshake; a dual-era client "MAY call it before
  any other request for up-front version selection, or use it as a
  backward-compatibility probe" ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)).
- Legacy-server detection over Streamable HTTP: "On `400 Bad Request`, the client
  SHOULD inspect the response body before falling back … If the body is empty or
  is not a recognized modern JSON-RPC error, fall back to `initialize` and
  continue with the legacy version for subsequent requests"
  ([transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)).
  A modern server signals an unsupported version with `-32022`; anything else
  (our SDK 1.x `-32000` "Bad Request: Unsupported protocol version …") is the
  legacy signal. The 2025-06-18 transport spec *mandates* that 400. **Our 400 is
  the sanctioned response, not a defect** — a JSON-RPC `-32601` would classify
  identically on the client side.
- Caching: "The era determination is a property of the server, not of an
  individual request. Clients SHOULD cache the result for the lifetime of the
  server process (stdio) or origin (HTTP), and MAY persist it across restarts"
  ([versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)).
  SDK v2 client: `versionNegotiation.mode` `legacy` (default, no probe) / `auto`
  (probe, fall back) / `{ pin }` (no fallback); `ConnectOptions.prior` skips the
  probe, and persistence of the verdict is the host's job.
- SDK 1.x (through 1.30.0, 2026-07-27) never gains 2026-07-28 support:
  `SUPPORTED_PROTOCOL_VERSIONS` is unchanged from 1.26.0. Only
  `@modelcontextprotocol/server` 2.x (GA, "v2 is the stable release line")
  serves both eras. Anthropic's note ("rolling out across Claude products")
  says nothing about probe cadence or caching.

### 2. Probe cadence (PostHog, production, 2026-09-04 02:40Z → 13:15Z)

Cite the queries (now in `docs/monitoring.md` 7.9), not the rows.

| measure | value |
| --- | --- |
| probes / distinct claude.ai clients | 148 / 59 (plus 1 from Claude Code desktop, agent-sdk 0.3.260) |
| probes followed by an `initialize` from the same client within 5 s | 128 of 146 (p50 gap 0 s); the rest within the client's next session |
| claude.ai `initialize` volume in the window | 1,193 for the probing clients; probes precede 176 of them (~15%) |
| day-level probe share of initializes | 10% (151 / 1,504) |
| inter-probe gap, same client | modal bucket 13–17 min (30 of 89 gaps); 18 gaps < 1 min (parallel contexts); 20 gaps > 60 min |
| clients that probed and never initialized | 0 |
| claude.ai clients active ≥ 20 min with **no** probe | 21 of 60 — the rollout is partial on Anthropic's side |

Reading: the probe is **per client, roughly every 15 minutes** (a cached
legacy verdict with a short TTL) — neither per connection nor per tool call,
and the heaviest client re-initialized 892 times against 57 probes. Cost: one
extra ~300-byte POST per client per quarter hour. Negligible.

### 3. Is `mcp-handler` 2.x a drop-in? No — near-drop-in with two silent hazards

From the 2.1.1 / `@modelcontextprotocol/server` 2.0.0 tarballs and the SDK
migration guide:

| change | our surface | consequence |
| --- | --- | --- |
| peer `@modelcontextprotocol/server ^2.0.0`, `zod ^4.2`, Node ≥ 20 | zod 4.3.6, Node 22 | add the server package explicitly |
| `createMcpHandler(init, options)` — 3rd arg gone, `basePath`/`redisUrl`/`maxDuration`/`disableSse` removed | we pass `{ basePath: '/api', verboseLogs: false }` | TS error; fold `verboseLogs`, drop `basePath` |
| `experimental_withMcpAuth` | used | still exported (alias of `withMcpAuth`), same signature, `WWW-Authenticate` still carries `resource_metadata` — the per-slug rewrite keeps working |
| **callback `extra` → `ctx`; `authInfo` moves to `ctx.http?.authInfo`** | all 19 tools destructure `{ authInfo }`; `withToolAnalytics` reads `extra.authInfo` | **every tool call fails auth** unless the `registerTool` patch maps it back — one-point fix, but a total outage if missed |
| `McpError` → `ProtocolError`, no `MCP error <code>:` prefix; unknown tool becomes a JSON-RPC `-32602` error on a 200, not an `isError` result | `withTransportObservability` regex `/MCP error -32602: …/` | **`mcp_input_validation_failed` silently stops firing** — the exact gap PR #114 closed |
| 405 for GET/DELETE in legacy-stateless; no 404 | `TRANSPORT_REJECT_STATUSES = {400,404,406,415}` | add 405 |
| raw `ZodRawShape` in `registerTool` | 19 registrations | compiles via a `@deprecated` overload |
| `scripts/test-mcp-tool-errors.ts` imports v1 paths | runs in `npm run build` via `mcp:lint` | must be ported or the build breaks |
| two SDK copies (1.26.0 under mcp-handler, 1.29.0 under `@clerk/mcp-tools`; `@clerk/mcp-tools` has no v2 release) | `verifyClerkToken` returns a plain object; SDK is a type import only | safe today and after — nothing crosses the class-identity boundary. Not worth a cleanup change |

The JWKS cache / auth-strategy memo (PR #79) and the emoji outcome classifier
sit entirely on our side of the handler and are untouched.

## Decision

**Ship the short term; reject the migration for now; write down what would
make it urgent.** The probe is spec-sanctioned, cached per client, and costs
~10% extra handshakes at zero user impact. The migration is five edits in one
file plus a script, two of which fail silently (auth on every call;
input-validation observability), against a GA line five weeks old whose
handler had a signature-breaking release one day after 2.0.0. That is not a
trade worth making to remove benign noise we can label instead.

Triggers that flip the decision (both queries live in `monitoring.md` 7.9):

1. **Lockout alarm > 0** — any client that probes and never initializes (a
   modern-only client). Migrate immediately behind a kill switch.
2. **Probe share of initializes climbing well past 10%** — a client that
   stopped caching the legacy verdict; the round trip is no longer negligible.
3. A new `protocol_version_header` value in the 7-day probes-by-version query
   — a client moved ahead again; re-evaluate.

When it is time, the migration plan is the table above. A runtime kill switch
is feasible: install 2.x under an npm alias (`"mcp-handler-v2": "npm:mcp-handler@2.1.1"`)
— its SDK peer uses the new `@modelcontextprotocol/server` name, so both
generations coexist — build the tool registration once as a function of the
`McpServer` instance, and pick the v1 or v2 handler per request from an env
flag (`MCP_HANDLER_V2=enabled`, default off, mirroring `MCP_AUTH_OPTIMIZATIONS`).
Validate with `/qa-hosted-mcp`, `/qa-claude-code`, `/qa-claude-code-cli`,
`scripts/mcp-auth-probe.ts`, and PR + `/deploy-pr-preview`; the two silent
hazards above each need an assertion in `mcp:lint` before the flag defaults on.

## Shipped in this branch

- `src/lib/mcpClientSignals.ts` — `classifyTransportRejection(message, methods)`:
  `server/discover` → `discover_probe`; the unsupported-version message on any
  other method → `unsupported_protocol_version`; else `sdk`. Also `rpc_method`
  (first method) as a scalar property for `GROUP BY`.
- `src/app/api/mcp/route.ts` — the SDK-4xx capture spreads the classifier
  instead of hardcoding `reason: 'sdk'`.
- `scripts/test-transport-rejections.ts` (in `mcp:lint`) — 13 classifier cases
  plus structural guards that the route keeps emitting the split.
- `docs/monitoring.md` 7.9 — rewritten: the four `reason` values and what each
  means, the corrected healthy reading, the 7-day probes-by-version query, and
  the lockout alarm with the migration triggers.
- `docs/analytics.md` — catalog rows for `mcp_transport_rejected` and
  `mcp_input_validation_failed` (neither was listed).

## Validation

- Local: `npx tsx scripts/test-transport-rejections.ts`, `npx tsc --noEmit`,
  `npm run lint` — all green.
- Preview (`/deploy-pr-preview`, PR #116): authenticated requests against the
  preview URL with a DCR bearer for USER_A, then the 7.9 query filtered to
  `properties.environment = 'preview'`:
  - `server/discover` under `MCP-Protocol-Version: 2026-07-28` → HTTP 400,
    row `reason = 'discover_probe'`, `rpc_method = 'server/discover'`. ✅
  - `initialize` under the same header → **HTTP 200**, no event. SDK 1.x skips
    `validateProtocolVersion` for initialization requests and negotiates down
    (`2025-11-25` in the result). So `unsupported_protocol_version` is reachable
    only from a post-handshake request — which is exactly what a modern-only
    client sends. Runbook wording corrected accordingly.
  - `tools/list` under the same header → HTTP 400, row
    `reason = 'unsupported_protocol_version'`, `rpc_method = 'tools/list'`. ✅
  - control `initialize` (2025-06-18, no header) → HTTP 200. ✅
