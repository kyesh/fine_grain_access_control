import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { shortLinks } from '@/db/schema';
import { captureServerEvent, captureServerError } from '@/lib/posthogServer';

/* ─── QR / flyer short links ─────────────────────────────────────────────────
   fgac.ai/go/<slug> — one slug per printed flyer variant × location, managed
   with scripts/short-links.ts (see its header for the slug naming scheme).

   Each human scan fires a server-side `flyer_scanned` PostHog event and bumps
   the row's counter, then 302s to the stored destination with UTM params
   appended so the client-side funnel ($pageview → sign_up_started → …)
   attributes to the physical variant. Server-side capture is deliberate:
   it survives ad-blockers and in-app browsers that never load posthog-js.

   Exactly one redirect hop — stacked redirects time out on phone cameras. */

// Link-preview crawlers and scanners hit short URLs whenever a link is shared
// (typically 5–10% of QR traffic). They still get the redirect, but no event
// and no counter bump, so scan numbers stay human.
const BOT_UA =
  /bot|crawl|spider|slurp|preview|scan|curl|wget|python-requests|facebookexternalhit|facebot|whatsapp|telegram|discord|slack|twitterbot|linkedinbot|pinterest|embedly|quora|vkshare|snap|applebot|headless/i;

function deviceClass(ua: string): string {
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: rawSlug } = await params;
  const slug = rawSlug.toLowerCase();
  const ua = request.headers.get('user-agent') ?? '';
  const isBot = ua === '' || BOT_UA.test(ua);

  let link: typeof shortLinks.$inferSelect | undefined;
  try {
    [link] = await db.select().from(shortLinks).where(eq(shortLinks.slug, slug)).limit(1);
  } catch (error) {
    // A DB hiccup must not eat a scan — send the visitor to the homepage.
    captureServerError('short_link_redirect', 'go/[slug] lookup', error);
    return NextResponse.redirect(new URL('/', request.nextUrl.origin), 302);
  }

  // Relative destinations resolve against the serving origin so the same row
  // works on localhost, previews, and production.
  const destination = new URL(link?.destination ?? '/', request.nextUrl.origin);
  if (link) {
    destination.searchParams.set('utm_source', 'qr');
    destination.searchParams.set('utm_medium', 'flyer');
    destination.searchParams.set('utm_campaign', link.campaign);
    destination.searchParams.set('utm_content', slug);
    destination.searchParams.set('ref', slug);
  }

  if (!isBot) {
    const geoCity = request.headers.get('x-vercel-ip-city');
    captureServerEvent(randomUUID(), 'flyer_scanned', {
      slug,
      slug_known: Boolean(link),
      campaign: link?.campaign,
      variant: link?.variant,
      channel: link?.channel,
      destination: destination.toString(),
      device: deviceClass(ua),
      geo_city: geoCity ? decodeURIComponent(geoCity) : null,
      geo_country: request.headers.get('x-vercel-ip-country'),
      // The event reaches PostHog from Vercel's IP; resolving THAT would
      // stamp every scan with the data center's location.
      $geoip_disable: true,
    });
    if (link) {
      after(() =>
        db
          .update(shortLinks)
          .set({
            scanCount: sql`${shortLinks.scanCount} + 1`,
            lastScannedAt: new Date(),
          })
          .where(eq(shortLinks.slug, slug))
          .catch((error) => captureServerError('short_link_redirect', 'go/[slug] counter', error)),
      );
    }
  }

  return NextResponse.redirect(destination, 302);
}
