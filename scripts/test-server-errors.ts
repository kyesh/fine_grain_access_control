/**
 * Unit tests for MCP server-error sanitization (src/lib/serverErrors.ts).
 * Run: npx tsx scripts/test-server-errors.ts  (part of `npm run mcp:lint`)
 *
 * Regression guard for 2026-08-26: a database failure inside the MCP
 * connection-resolution path escaped unwrapped, and the MCP SDK rendered
 * `error.message` into the tool result. Drizzle's DrizzleQueryError message is
 * the full SQL statement plus every bound parameter, so an MCP client received
 * a raw `users` SELECT and the caller's Clerk user id.
 *
 * The load-bearing assertions are:
 *   1. the client message never contains anything derived from the error, and
 *   2. the log line DOES contain the cause chain — the reason for the failure
 *      lives in `.cause`, which DrizzleQueryError's own message omits.
 */
import { describeErrorForLog, clientErrorMessage, logAndSanitize } from '../src/lib/serverErrors';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}

/** Faithful stand-in for drizzle-orm's DrizzleQueryError (see errors.js). */
class FakeDrizzleQueryError extends Error {
  query: string;
  params: unknown[];
  constructor(query: string, params: unknown[], cause?: unknown) {
    super(`Failed query: ${query}\nparams: ${params}`);
    this.name = 'Error';
    this.query = query;
    this.params = params;
    this.cause = cause;
  }
}

const SQL = 'select "id", "clerk_user_id", "email", "deleted_at", "created_at", "updated_at" '
  + 'from "users" "users" where "users"."clerk_user_id" = $1 limit $2';
const CLERK_ID = 'user_TESTONLYnotarealclerkid';

function main() {
  const cause = new Error("password authentication failed for user 'neondb_owner'");
  cause.name = 'NeonDbError';
  const err = new FakeDrizzleQueryError(SQL, [CLERK_ID, 1], cause);

  // ---- The client message leaks nothing --------------------------------
  const client = clientErrorMessage();
  check('client message omits the SQL statement', !client.includes('select "id"'));
  check('client message omits the table name', !client.includes('users'));
  check('client message omits the Clerk user id', !client.includes(CLERK_ID));
  check('client message omits "Failed query"', !client.includes('Failed query'));
  check('client message omits the driver error text', !client.includes('neondb_owner'));
  check('client message is non-empty and actionable',
    client.length > 20 && /retry/i.test(client));

  // Structural guard: a function that cannot see the error cannot leak it.
  // A behavioural test alone would not foreclose a future refactor that
  // starts interpolating `err.message` "just for the useful cases".
  check('clientErrorMessage takes no error argument', clientErrorMessage.length === 0);

  // Same message regardless of what threw — including a hostile message that
  // is itself trying to look like a normal tool response.
  check('client message is identical for an unrelated error',
    logAndSilently(() => logAndSanitize('t', new Error(`leak ${CLERK_ID}`))) === client);
  check('client message is identical for a non-Error throw',
    logAndSilently(() => logAndSanitize('t', SQL)) === client);

  // ---- The log line keeps everything -----------------------------------
  const log = describeErrorForLog(err);
  check('log keeps the SQL statement', log.includes('from "users"'));
  check('log keeps the bound params', log.includes(CLERK_ID));
  check('log keeps the cause chain (the part Drizzle omits)',
    log.includes('NeonDbError') && log.includes('neondb_owner'));
  check('log marks the causal link', log.includes('caused by'));

  // ---- Chain handling ---------------------------------------------------
  const deep = new Error('l0', { cause: new Error('l1', { cause: new Error('l2', { cause: new Error('l3', { cause: new Error('l4', { cause: new Error('l5-too-deep') }) }) }) }) });
  const deepLog = describeErrorForLog(deep);
  check('cause chain is depth-bounded', !deepLog.includes('l5-too-deep'));
  check('cause chain renders up to the bound', deepLog.includes('l4'));

  const cyclic = new Error('a');
  (cyclic as { cause?: unknown }).cause = cyclic;
  check('a cyclic cause chain terminates', describeErrorForLog(cyclic).length < 5000);

  check('a non-Error throw still describes', describeErrorForLog('plain string').includes('plain string'));
  check('undefined still describes', describeErrorForLog(undefined).length > 0);

  if (failures > 0) {
    console.error(`\n✗ server-error sanitization: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\n✓ server-error sanitization: all checks passed');
}

/** Run fn with console.error muted — logAndSanitize logs by design. */
function logAndSilently<T>(fn: () => T): T {
  const real = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = real; }
}

main();
