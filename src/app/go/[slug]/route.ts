import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { shortLinks } from '@/db/schema';
import { captureServerEvent, captureServerError } from '@/lib/posthogServer';
import { shortLinkUtm } from '@/lib/shortLinkUtm';

/* ─── QR / flyer / reply short links ─────────────────────────────────────────
   fgac.ai/go/<slug> — one slug per printed flyer variant × location, plus one
   per outreach channel for the growth-prospecting digest (/go/hn, /go/rd,
   /go/gh, /go/x — campaign `prospecting`), managed with scripts/short-links.ts
   (see its header for the slug naming scheme).

   Each human scan fires a server-side `flyer_scanned` PostHog event and bumps
   the row's counter, then 302s to the stored destination with UTM params
   appended so the client-side funnel ($pageview → sign_up_started → …)
   attributes to the physical variant. Server-side capture is deliberate:
   it survives ad-blockers and in-app browsers that never load posthog-js.

   Nothing here may delay or break the redirect: analytics and the counter run
   in after(), and a bad row or DB hiccup falls back to the homepage. Exactly
   one redirect hop — stacked redirects time out on phone cameras. */

// Link-preview crawlers and scanners hit short URLs whenever a link is shared
// (typically 5–10% of QR traffic). They still get the redirect, but no event
// and no counter bump, so scan numbers stay human. Deliberately narrow:
// substrings like "scan"/"preview"/"snapchat" match HUMAN QR-scanner apps and
// in-app browsers — the campaign's core traffic — and must not appear here.
// ("whatsapp/" is WhatsApp's preview fetcher; its in-app browser UA differs.)
const BOT_UA =
  /bot|crawl|spider|slurp|curl|wget|python-requests|headless|facebookexternalhit|facebot|embedly|quora|vkshare|whatsapp\//i;

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
  const origin = request.nextUrl.origin;

  let link: typeof shortLinks.$inferSelect | undefined;
  let lookupFailed = false;
  try {
    [link] = await db.select().from(shortLinks).where(eq(shortLinks.slug, slug)).limit(1);
  } catch (error) {
    lookupFailed = true;
    captureServerError('short_link_redirect', 'go/[slug] lookup', error);
  }

  // Relative destinations resolve against the serving origin so the same row
  // works on localhost, previews, and production. The CLI validates
  // destinations at write time, but an unparseable row must degrade to the
  // homepage, not a 500 — the QR is already printed.
  let destination: URL;
  try {
    destination = new URL(link?.destination ?? '/', origin);
  } catch (error) {
    captureServerError('short_link_redirect', 'go/[slug] destination parse', error);
    destination = new URL('/', origin);
  }
  if (link) {
    // qr/flyer for printed campaigns; <channel>/reply for the `prospecting`
    // campaign's manual-reply links (see src/lib/shortLinkUtm.ts).
    const utm = shortLinkUtm(link);
    destination.searchParams.set('utm_source', utm.utm_source);
    destination.searchParams.set('utm_medium', utm.utm_medium);
    destination.searchParams.set('utm_campaign', link.campaign);
    destination.searchParams.set('utm_content', slug);
    destination.searchParams.set('ref', slug);
  }

  if (!isBot) {
    // Snapshot request-derived values now; the work itself runs after the
    // response so the 302 is never behind a PostHog or Neon round-trip.
    const geoCityHeader = request.headers.get('x-vercel-ip-city');
    let geoCity: string | null = geoCityHeader;
    try {
      geoCity = geoCityHeader ? decodeURIComponent(geoCityHeader) : null;
    } catch {
      // Malformed header (only possible off-Vercel) — keep it encoded.
    }
    const eventProps = {
      slug,
      slug_known: Boolean(link),
      lookup_failed: lookupFailed,
      campaign: link?.campaign,
      variant: link?.variant,
      channel: link?.channel,
      destination: destination.toString(),
      device: deviceClass(ua),
      // Without a UA on the event, PostHog's virtual traffic classification
      // marks every scan $virt_is_bot (no_user_agent) and web-analytics views
      // that filter bots drop all real scans. $raw_user_agent is what the
      // classifier reads; $useragent additionally feeds $browser/$os parsing.
      $raw_user_agent: ua,
      $useragent: ua,
      geo_city: geoCity,
      geo_country: request.headers.get('x-vercel-ip-country'),
      // Anonymous scans must not mint PostHog person profiles (a billed
      // dimension); attribution to the web funnel flows via the UTM params,
      // not the distinct id.
      $process_person_profile: false,
      // The event reaches PostHog from Vercel's IP; resolving THAT would
      // stamp every scan with the data center's location.
      $geoip_disable: true,
    };
    after(() => {
      captureServerEvent(randomUUID(), 'flyer_scanned', eventProps);
      if (link && !lookupFailed) {
        return db
          .update(shortLinks)
          .set({
            scanCount: sql`${shortLinks.scanCount} + 1`,
            lastScannedAt: new Date(),
          })
          .where(eq(shortLinks.slug, slug))
          .catch((error) => captureServerError('short_link_redirect', 'go/[slug] counter', error));
      }
    });
  }

  return NextResponse.redirect(destination, 302);
}
