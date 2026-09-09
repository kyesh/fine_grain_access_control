/**
 * Unit tests for the approve page's request-UA classifier
 * (src/lib/approveClientClass.ts).
 * Run: npx tsx scripts/test-approve-client-class.ts  (part of `npm run mcp:lint`)
 *
 * The invariant that matters: Claude desktop's in-app browser is a PERSON,
 * not an agent. Its UA carries a `Claude/<build>` token inside an otherwise
 * ordinary Chrome string, and the bare /claude/i agent test used to count
 * those opens as agent-driven (19 opens / 7 people in the 30 days to
 * 2026-09-09, every one followed by human clicks on the page).
 */
import { classifyApproveClient } from '../src/lib/approveClientClass';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const CLAUDE_DESKTOP_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.46388.4 Chrome/148.0.7778.280 Safari/537.36 MSIX';
const CLAUDE_DESKTOP_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.49585.0 Chrome/152.0.7977.76 Safari/537.36';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';

console.log('people:');
check('regular Chrome → browser', classifyApproveClient(CHROME_WIN).client === 'browser');
check('regular Chrome is not agent_driven', classifyApproveClient(CHROME_WIN).agent_driven === false);
check('iOS Safari → browser', classifyApproveClient(SAFARI_IOS).client === 'browser');
check('Claude desktop (Windows) → claude_desktop', classifyApproveClient(CLAUDE_DESKTOP_WIN).client === 'claude_desktop');
check('Claude desktop (Mac) → claude_desktop', classifyApproveClient(CLAUDE_DESKTOP_MAC).client === 'claude_desktop');
check('Claude desktop is NOT agent_driven', classifyApproveClient(CLAUDE_DESKTOP_WIN).agent_driven === false);

console.log('agents:');
for (const ua of [
  'Claude-User/1.0 (+https://www.anthropic.com/claude-user)',
  'Mozilla/5.0 (compatible; anthropic-ai/1.0)',
  'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)',
  'python-requests/2.32.3',
  'axios/1.7.2',
  'curl/8.6.0',
  'Wget/1.21',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/128.0.0.0 Safari/537.36',
  'Googlebot/2.1 (+http://www.google.com/bot.html)',
]) {
  const c = classifyApproveClient(ua);
  check(`${ua.slice(0, 32)}… → agent`, c.client === 'agent' && c.agent_driven === true);
}

console.log('edge cases:');
check('empty UA → browser (unknown, not agent)', classifyApproveClient('').client === 'browser');
check('Electron without the Claude token stays agent (unchanged behaviour)',
  classifyApproveClient('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0 Electron/31.0 Safari/537.36').client === 'agent');
check('the word "Claude" in a page title-like UA without Chrome/ after it is agent, not desktop',
  classifyApproveClient('Claude/2.0 (bot)').client === 'agent');

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll approve client classification checks passed.');
