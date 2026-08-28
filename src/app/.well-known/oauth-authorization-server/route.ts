/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 *
 * This endpoint returns Clerk's authorization server configuration —
 * authorize, token, and registration endpoints.
 * MCP clients use this to know where to send the user for login
 * and where to exchange authorization codes for tokens.
 *
 * SPIKE: Validates that Clerk exposes the right endpoints for DCR + PKCE.
 */
import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from '@clerk/mcp-tools/next';
import { captureServerEvent } from '@/lib/posthogServer';
import { installFingerprint } from '@/lib/mcpClientSignals';

const handler = authServerMetadataHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();

// Install-funnel measurement: fetched when a client begins the connector
// OAuth handshake — pre-Clerk-account visibility. Rate metric per event
// (recurs on reconnects); uniq(properties.install_fingerprint) is the
// unique-installer count. The Clerk helper handles the response itself.
const trackedGet = (req: Request) => {
  captureServerEvent('anonymous-mcp', 'connector_install_started', {
    touchpoint: 'oauth_discovery',
    endpoint: 'authorization-server',
    user_agent: req.headers.get('user-agent') ?? undefined,
    install_fingerprint: installFingerprint(req),
  });
  return handler();
};

export const GET = trackedGet;
export const OPTIONS = corsHandler;
