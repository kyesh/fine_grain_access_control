/**
 * Unit tests for the transport-rejection classifier
 * (src/lib/mcpClientSignals.ts: classifyTransportRejection) and a structural
 * guard on the MCP route's capture site.
 * Run: npx tsx scripts/test-transport-rejections.ts  (part of `npm run mcp:lint`)
 *
 * Background (2026-09-04 analytics review): within hours of the event
 * shipping, 100% of production `mcp_transport_rejected` rows were claude.ai
 * clients on MCP 2026-07-28 sending the `server/discover` probe, taking our
 * SDK 1.x "Unsupported protocol version" 400, and falling back to
 * `initialize` seconds later — the spec-sanctioned legacy path, nobody
 * locked out. The runbook read that message as "user silently broken", so
 * the classifier splits the benign probe from a real refusal and the route
 * must keep emitting the split.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyTransportRejection } from '../src/lib/mcpClientSignals';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}

const UNSUPPORTED = 'Bad Request: Unsupported protocol version: 2026-07-28 (supported versions: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07)';

console.log('classifyTransportRejection');
{
  const r = classifyTransportRejection(UNSUPPORTED, ['server/discover']);
  check('server/discover + unsupported-version 400 → discover_probe', r.reason === 'discover_probe');
  check('discover probe carries rpc_method as a scalar', r.rpc_method === 'server/discover');
}
check('server/discover with any other 4xx body is still the probe',
  classifyTransportRejection('Bad Request: Server not initialized', ['server/discover']).reason === 'discover_probe');
check('server/discover with no readable body is still the probe',
  classifyTransportRejection(undefined, ['server/discover']).reason === 'discover_probe');
{
  const r = classifyTransportRejection(UNSUPPORTED, ['initialize']);
  check('initialize + unsupported-version 400 → unsupported_protocol_version (a truly refused client)',
    r.reason === 'unsupported_protocol_version');
  check('…with rpc_method initialize', r.rpc_method === 'initialize');
}
check('tools/call + unsupported-version 400 → unsupported_protocol_version',
  classifyTransportRejection(UNSUPPORTED, ['tools/call']).reason === 'unsupported_protocol_version');
check('unsupported-version message with an unparsed body (no methods) → unsupported_protocol_version',
  classifyTransportRejection(UNSUPPORTED, undefined).reason === 'unsupported_protocol_version');
check('batched initialize rejection stays sdk',
  classifyTransportRejection('Bad Request: Only one initialization request is allowed', ['initialize', 'initialize']).reason === 'sdk');
check('Accept-header 406 stays sdk',
  classifyTransportRejection('Not Acceptable: Client must accept both application/json and text/event-stream', ['tools/call']).reason === 'sdk');
check('empty body, no methods → sdk with no rpc_method', (() => {
  const r = classifyTransportRejection(undefined, []);
  return r.reason === 'sdk' && r.rpc_method === undefined;
})());
check('rpc_method is the FIRST method of a batch',
  classifyTransportRejection('x', ['tools/list', 'tools/call']).rpc_method === 'tools/list');
check('a message that merely contains the phrase mid-string is not the version rejection',
  classifyTransportRejection('Internal: Bad Request: Unsupported protocol version', ['tools/call']).reason === 'sdk');

console.log('route wiring (structural)');
const route = readFileSync(join(__dirname, '..', 'src', 'app', 'api', 'mcp', 'route.ts'), 'utf8');
const capture = route.slice(route.indexOf('TRANSPORT_REJECT_STATUSES.has(res.status)'));
check('the SDK-4xx capture spreads classifyTransportRejection(message, envelope?.methods)',
  /\.\.\.classifyTransportRejection\(message, envelope\?\.methods\)/.test(capture.slice(0, 1200)));
check("the SDK-4xx capture no longer hardcodes reason: 'sdk'",
  !/reason: 'sdk'/.test(capture.slice(0, 1200)));
check('classifyTransportRejection is imported from @/lib/mcpClientSignals',
  /import \{[^}]*classifyTransportRejection[^}]*\} from '@\/lib\/mcpClientSignals'/.test(route));

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall transport-rejection checks passed');
