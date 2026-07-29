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

export function GET(req: Request) {
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
