import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)']);

export default clerkMiddleware(async (auth, req) => {
  const url = req.nextUrl.clone();
  const hostname = url.hostname;

  // Route token exchange requests
  if (hostname.startsWith('oauth2.') && url.pathname === '/token') {
    url.pathname = '/api/auth/token';
    return NextResponse.rewrite(url);
  }

  // Route API Proxy requests
  if (hostname.startsWith('gmail.')) {
    url.pathname = `/api/proxy${url.pathname}`;
    return NextResponse.rewrite(url);
  }

  // Local dev: rewrite /gmail/v1/... → /api/proxy/gmail/v1/...
  // The Google SDK strips the path from rootUrl, so rootUrl='http://localhost:3000/api/proxy/'
  // actually sends requests to http://localhost:3000/gmail/v1/... which needs this rewrite.
  // In production, the gmail.fgac.ai subdomain handles this via the hostname check above.
  if (process.env.NODE_ENV === 'development' && url.pathname.startsWith('/gmail/')) {
    url.pathname = `/api/proxy${url.pathname}`;
    return NextResponse.rewrite(url);
  }

  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
