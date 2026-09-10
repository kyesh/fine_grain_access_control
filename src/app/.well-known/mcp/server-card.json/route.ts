/**
 * Static MCP server card — Smithery's documented fallback for servers whose
 * automatic scan cannot complete (smithery.ai/docs/build/publish).
 *
 * Smithery's scanner registers itself via Client ID Metadata Documents; FGAC's
 * authorization server (Clerk) speaks Dynamic Client Registration instead, so
 * the scan may stall at the auth wall. When it does, Smithery reads
 * /.well-known/mcp/server-card.json for the listing metadata instead.
 *
 * The card is derived at request time from the two sources of truth that
 * already exist — server.json (registry listing: name, title, description,
 * version, remotes) and TOOL_DEFS (the tool catalogue the MCP endpoint
 * registers) — so it cannot drift from either. Tool input schemas are declared
 * inline with the zod registrations in src/app/api/mcp/route.ts and are not
 * reproduced here; the card advertises each tool as an object-input tool and
 * points at the live endpoint, which is the contract.
 */
import { TOOL_DEFS, toolAnnotations } from '@/app/api/mcp/toolDefs';
import serverJson from '../../../../../server.json';

const REMOTE_URL = serverJson.remotes[0].url;
const ORIGIN = new URL(REMOTE_URL).origin;

export function GET() {
  const tools = Object.values(TOOL_DEFS).map((def) => ({
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: { type: 'object', additionalProperties: true },
    annotations: toolAnnotations(def),
  }));

  const card = {
    serverInfo: {
      name: serverJson.name,
      title: serverJson.title,
      version: serverJson.version,
    },
    description: serverJson.description,
    websiteUrl: serverJson.websiteUrl,
    repository: serverJson.repository,
    remotes: serverJson.remotes,
    authentication: {
      required: true,
      schemes: ['oauth2'],
      // RFC 9728 / RFC 8414 discovery documents the live endpoint advertises.
      protectedResourceMetadata: `${ORIGIN}/.well-known/oauth-protected-resource/mcp`,
      authorizationServerMetadata: `${ORIGIN}/.well-known/oauth-authorization-server`,
      dynamicClientRegistration: true,
    },
    tools,
    resources: [],
    prompts: [],
  };

  return Response.json(card, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
