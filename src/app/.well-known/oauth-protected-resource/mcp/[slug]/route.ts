/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) — profile-addressed MCP URLs.
 *
 * A client connecting to /api/mcp/<slug> is sent here by the 401's
 * resource_metadata pointer. Per the MCP auth spec (2025-06-18) the `resource`
 * value MUST match the MCP server URL exactly as the user entered it,
 * including the profile slug, so each profile URL gets its own metadata
 * document. The slug is addressing only — the authorization server (Clerk)
 * and everything else is identical to the base /api/mcp metadata.
 */
import {
  generateClerkProtectedResourceMetadata,
  corsHeaders,
} from '@clerk/mcp-tools/server';
import { metadataCorsOptionsRequestHandler } from '@clerk/mcp-tools/next';
import { captureServerEvent } from '@/lib/posthogServer';
import { installFingerprint } from '@/lib/mcpClientSignals';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) {
    return Response.json({ error: 'invalid_resource' }, { status: 404 });
  }

  captureServerEvent('anonymous-mcp', 'connector_install_started', {
    touchpoint: 'oauth_discovery',
    endpoint: 'protected-resource',
    profile_slug: slug,
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
    resourceUrl: `${origin}/api/mcp/${slug}`,
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
