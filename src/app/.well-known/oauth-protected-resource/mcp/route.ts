/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 *
 * This endpoint tells MCP clients where to authenticate.
 * When a client hits /api/mcp and gets a 401, it follows the WWW-Authenticate
 * header to this endpoint, which points it to Clerk's authorization server.
 *
 * We build the metadata ourselves rather than using Clerk's
 * protectedResourceHandlerClerk because that helper sets `resource` to the
 * bare origin. Claude requires the `resource` field to match the MCP server
 * URL exactly as users enter it — including the /api/mcp path.
 */
import {
  generateClerkProtectedResourceMetadata,
  corsHeaders,
} from '@clerk/mcp-tools/server';
import { metadataCorsOptionsRequestHandler } from '@clerk/mcp-tools/next';
import { captureServerEvent } from '@/lib/posthogServer';
import { installFingerprint } from '@/lib/mcpClientSignals';

export function GET(req: Request) {
  // Install-funnel measurement: clients fetch this metadata when they begin
  // the connector OAuth handshake — the earliest FGAC-owned touchpoint before
  // any Clerk account exists. Rate metric per event (recurs on reconnects);
  // uniq(properties.install_fingerprint) is the unique-installer count.
  captureServerEvent('anonymous-mcp', 'connector_install_started', {
    touchpoint: 'oauth_discovery',
    endpoint: 'protected-resource',
    user_agent: req.headers.get('user-agent') ?? undefined,
    install_fingerprint: installFingerprint(req),
  });

  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    return Response.json({ error: 'server_misconfigured' }, { status: 500 });
  }

  const origin = new URL(req.url).origin;
  const metadata = generateClerkProtectedResourceMetadata({
    publishableKey,
    resourceUrl: `${origin}/api/mcp`,
  });

  return Response.json(metadata, {
    headers: {
      'Cache-Control': 'max-age=3600',
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
