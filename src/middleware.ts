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

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
