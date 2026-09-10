/**
 * Unit tests for src/lib/shortLinkUtm.ts (the /go/<slug> UTM mapping).
 * Run: npx tsx scripts/test-short-link-utm.ts  (part of `npm run mcp:lint`)
 *
 * Two invariants: flyer rows must keep utm_source=qr / utm_medium=flyer
 * byte-for-byte (live campaign dashboards filter on them), and prospecting
 * rows must attribute to their channel so manual replies on HN / Reddit /
 * GitHub / X show up as separate channels, never as QR scans.
 */
import { shortLinkUtm, PROSPECTING_CAMPAIGN } from '../src/lib/shortLinkUtm';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log('flyer rows are unchanged:');
check('fall26 kiosk row → qr/flyer', eq(shortLinkUtm({ campaign: 'fall26', channel: 'umich-kiosk' }), { utm_source: 'qr', utm_medium: 'flyer' }));
check('null channel → qr/flyer', eq(shortLinkUtm({ campaign: 'fall26', channel: null }), { utm_source: 'qr', utm_medium: 'flyer' }));
check('unknown campaign → qr/flyer', eq(shortLinkUtm({ campaign: 'anything-else', channel: 'hn' }), { utm_source: 'qr', utm_medium: 'flyer' }));

console.log('prospecting rows attribute to their channel:');
for (const channel of ['hn', 'reddit', 'github', 'x']) {
  check(`${channel} → ${channel}/reply`, eq(shortLinkUtm({ campaign: PROSPECTING_CAMPAIGN, channel }), { utm_source: channel, utm_medium: 'reply' }));
}
check('missing channel → community/reply', eq(shortLinkUtm({ campaign: PROSPECTING_CAMPAIGN, channel: null }), { utm_source: 'community', utm_medium: 'reply' }));
check('blank channel → community/reply', eq(shortLinkUtm({ campaign: PROSPECTING_CAMPAIGN, channel: '  ' }), { utm_source: 'community', utm_medium: 'reply' }));
check('campaign match is exact (Prospecting ≠ prospecting)', eq(shortLinkUtm({ campaign: 'Prospecting', channel: 'hn' }), { utm_source: 'qr', utm_medium: 'flyer' }));

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall short-link UTM checks passed');
