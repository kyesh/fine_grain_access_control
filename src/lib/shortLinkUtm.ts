/**
 * UTM parameters appended by the /go/<slug> redirect.
 *
 * Short links started life as printed QR codes (utm_source=qr, utm_medium=
 * flyer). The growth-prospecting digest (scripts/growth-prospects.ts) reuses
 * the same table for links Ken pastes into manual replies on HN / Reddit /
 * GitHub / X, and those must NOT be attributed to "qr" — the PostHog channel
 * table splits on utm_source. Rows in the `prospecting` campaign therefore
 * attribute to their `channel` column instead.
 *
 * Existing flyer rows keep their exact historical parameters: the fall-2026
 * poster funnel is live and its dashboards filter on utm_source=qr.
 */
export const PROSPECTING_CAMPAIGN = 'prospecting';

export type ShortLinkUtm = { utm_source: string; utm_medium: string };

export function shortLinkUtm(link: { campaign: string; channel: string | null }): ShortLinkUtm {
  if (link.campaign === PROSPECTING_CAMPAIGN) {
    return { utm_source: link.channel?.trim() || 'community', utm_medium: 'reply' };
  }
  return { utm_source: 'qr', utm_medium: 'flyer' };
}
