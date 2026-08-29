import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextFetchEvent, NextRequest } from 'next/server';
import { MCP_PROFILE_PATH_RE } from '@/lib/profileSlugs';

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)']);

const clerkHandler = clerkMiddleware(async (auth, req) => {
  const url = req.nextUrl.clone();
  const hostname = url.hostname;

  // Profile-addressed MCP URLs: /api/mcp/<slug> is the same MCP server, with
  // the slug naming which of the caller's agent profiles a NEW connection
  // should bind to (addressing, not authorization — the bearer token still
  // decides the user, and the slug only resolves among that user's profiles).
  // mcp-handler matches the pathname '/api/mcp' exactly, so the slug is moved
  // into a request header before the route sees it.
  const profileMatch = url.pathname.match(MCP_PROFILE_PATH_RE);
  if (profileMatch) {
    url.pathname = '/api/mcp';
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-fgac-profile-slug', profileMatch[1]);
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  // Route token exchange requests
  if (hostname.startsWith('oauth2.') && url.pathname === '/token') {
    url.pathname = '/api/auth/token';
    return NextResponse.rewrite(url);
  }

  // Route API Proxy requests (production subdomain: gmail.fgac.ai)
  if (hostname.startsWith('gmail.')) {
    url.pathname = `/api/proxy${url.pathname}`;
    return NextResponse.rewrite(url);
  }

  // Local dev: The Google SDK's rootUrl only uses the origin for URL construction,
  // so requests arrive at /gmail/v1/... instead of /api/proxy/gmail/v1/...
  // In production, the gmail.fgac.ai subdomain + the rewrite above handles this.
  if (process.env.NODE_ENV === 'development' && url.pathname.startsWith('/gmail/')) {
    url.pathname = `/api/proxy${url.pathname}`;
    return NextResponse.rewrite(url);
  }

  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

/**
 * Clerk's decodeJwt (@clerk/backend 3.4.7, chunk-HVNR6UQP) JSON-parses the
 * header/payload of any 3-segment Bearer token without a try/catch, so a
 * structurally malformed token (`Bearer bogus.token.value`) throws a raw
 * SyntaxError inside clerkMiddleware's authenticateRequest — before any route
 * handler runs — and surfaces as a 500. Well-formed-but-invalid JWTs come back
 * as TokenVerificationError values and 401 correctly; only the malformed shape
 * escapes. Convert exactly that escape into the 401 the route's auth wrapper
 * would have produced, so malformed tokens fail closed. /api/mcp responses
 * carry the resource_metadata pointer mcp-handler puts on its own 401s, so MCP
 * clients still enter OAuth discovery.
 */
export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  try {
    return await clerkHandler(req, event);
  } catch (err) {
    const hasBearer = req.headers.get('authorization')?.toLowerCase().startsWith('bearer ');
    if (!(err instanceof SyntaxError) || !hasBearer) throw err;

    console.warn('[middleware] Rejecting malformed bearer token:', err.message);
    const isMcp = req.nextUrl.pathname.startsWith('/api/mcp');
    const slugMatch = req.nextUrl.pathname.match(MCP_PROFILE_PATH_RE);
    const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(/:$/, '');
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    const origin = host ? `${proto}://${host}` : req.nextUrl.origin;
    const metadataPath = `/.well-known/oauth-protected-resource/mcp${slugMatch ? `/${slugMatch[1]}` : ''}`;
    const wwwAuthenticate = `Bearer error="invalid_token", error_description="Malformed access token"`
      + (isMcp ? `, resource_metadata="${origin}${metadataPath}"` : '');
    return new NextResponse(
      JSON.stringify({ error: 'invalid_token', error_description: 'Malformed access token' }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': wwwAuthenticate,
        },
      },
    );
  }
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
