/**
 * Unit tests for the MCP auth layer's connection-touch memo
 * (src/lib/connectionTouchMemo.ts).
 * Run: npx tsx scripts/test-connection-touch-memo.ts  (part of `npm run mcp:lint`)
 *
 * Background (2026-09-08): automation that spawns a fresh Claude Code process
 * every ~30 s re-runs the MCP handshake each time; the auth layer answered
 * every one of those requests with four Neon round trips and a PostHog event
 * whose only consumer is a daily attribution query. The memo skips the DB
 * touch inside a short window and coalesces the telemetry, without ever
 * suppressing the first initialize that backfills the connection's name.
 */
import {
  shouldSkipEagerResolve,
  recordEagerResolve,
  coalesceInitialize,
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

console.log('coalesceInitialize');
{
  resetTouchMemoForTests();
  check('first initialize on an instance is captured with 0 coalesced', coalesceInitialize(U, C, T0) === 0);
  check('second within the window is suppressed', coalesceInitialize(U, C, T0 + 30_000) === undefined);
  check('third within the window is suppressed', coalesceInitialize(U, C, T0 + 60_000) === undefined);
  const n = coalesceInitialize(U, C, T0 + TOUCH_MEMO_TTL_MS);
  check('first after the window is captured and reports the 2 suppressed', n === 2);
  check('counter resets after a capture', coalesceInitialize(U, C, T0 + TOUCH_MEMO_TTL_MS + 30_000) === undefined);
  check('the true count is reconstructible: sum(1 + coalesced) over captures', 1 + 0 + 1 + (n ?? 0) === 4);

  // Interplay: the coalescing entry must not make the DB touch look fresh.
  check('a coalesce-only entry does not skip the eager resolve', shouldSkipEagerResolve(U, C, false, T0 + 1) === false);
  recordEagerResolve(U, C, true, T0 + 2);
  check('the resolve record keeps the capture window', coalesceInitialize(U, C, T0 + TOUCH_MEMO_TTL_MS + 40_000) === undefined);
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
