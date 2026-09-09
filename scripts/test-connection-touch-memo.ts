/**
 * Unit tests for the MCP auth layer's connection-touch memo
 * (src/lib/connectionTouchMemo.ts).
 * Run: npx tsx scripts/test-connection-touch-memo.ts  (part of `npm run mcp:lint`)
 *
 * Background (2026-09-08): automation that spawns a fresh Claude Code process
 * every ~30 s re-runs the MCP handshake each time; the auth layer answered
 * every one of those requests with four Neon round trips and a PostHog event
 * whose result nothing consumed. The memo skips the DB touch inside a short
 * window, without ever skipping the first initialize that backfills the
 * connection's name.
 */
import {
  shouldSkipEagerResolve,
  recordEagerResolve,
  resetTouchMemoForTests,
  touchMemoSize,
  TOUCH_MEMO_TTL_MS,
  TOUCH_MEMO_MAX,
} from '../src/lib/connectionTouchMemo';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL ${name}`); }
  else console.log(`  ok   ${name}`);
}

const U = 'user_test';
const C = 'client_test';
const T0 = 1_000_000;

console.log('shouldSkipEagerResolve');
{
  resetTouchMemoForTests();
  check('cold miss never skips', shouldSkipEagerResolve(U, C, false, T0) === false);
  check('cold miss never skips an initialize', shouldSkipEagerResolve(U, C, true, T0) === false);

  recordEagerResolve(U, C, false, T0);
  check('non-initialize inside TTL skips', shouldSkipEagerResolve(U, C, false, T0 + 1000) === true);
  check('initialize does NOT skip while the row is unnamed', shouldSkipEagerResolve(U, C, true, T0 + 1000) === false);

  recordEagerResolve(U, C, true, T0 + 2000);
  check('initialize skips once the row is named', shouldSkipEagerResolve(U, C, true, T0 + 3000) === true);
  check('TTL expiry re-runs the resolve', shouldSkipEagerResolve(U, C, false, T0 + 2000 + TOUCH_MEMO_TTL_MS) === false);
  check('a different client is a miss', shouldSkipEagerResolve(U, 'client_other', false, T0 + 3000) === false);
  check('a different user with the same client id is a miss', shouldSkipEagerResolve('user_other', C, false, T0 + 3000) === false);
}

console.log('bounded LRU');
{
  resetTouchMemoForTests();
  for (let i = 0; i < TOUCH_MEMO_MAX + 50; i++) recordEagerResolve(U, `client_${i}`, true, T0);
  check(`size is capped at ${TOUCH_MEMO_MAX}`, touchMemoSize() === TOUCH_MEMO_MAX);
  check('oldest entry was evicted', shouldSkipEagerResolve(U, 'client_0', false, T0 + 1) === false);
  check('newest entry survives', shouldSkipEagerResolve(U, `client_${TOUCH_MEMO_MAX + 49}`, false, T0 + 1) === true);
  // Reading an entry refreshes its recency.
  resetTouchMemoForTests();
  recordEagerResolve(U, 'client_a', true, T0);
  for (let i = 0; i < TOUCH_MEMO_MAX - 1; i++) recordEagerResolve(U, `client_${i}`, true, T0);
  shouldSkipEagerResolve(U, 'client_a', false, T0 + 1); // refresh
  recordEagerResolve(U, 'client_new', true, T0);
  check('a recently read entry is not the eviction victim', shouldSkipEagerResolve(U, 'client_a', false, T0 + 1) === true);
  check('the stale entry was evicted instead', shouldSkipEagerResolve(U, 'client_0', false, T0 + 1) === false);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
