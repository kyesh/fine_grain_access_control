/**
 * Integration test: what an MCP CLIENT receives when a tool's work throws.
 * Run: npx tsx scripts/test-mcp-tool-errors.ts  (part of `npm run mcp:lint`)
 *
 * Unlike scripts/test-server-errors.ts (which unit-tests the sanitizer), this
 * drives the REAL @modelcontextprotocol/sdk server and a REAL in-memory client
 * over a linked transport, because the defect being guarded is a property of
 * the SDK, not of our code: a tool callback that THROWS is turned into
 * `createToolError(error.message)` and the message is rendered verbatim into
 * the tool result (sdk/server/mcp.js).
 *
 * That is how, on 2026-08-26, an MCP client was shown
 *
 *     Failed query: select "id", "clerk_user_id", … from "users" …
 *     params: user_…
 *
 * — Drizzle's DrizzleQueryError message, which is the whole SQL statement plus
 * every bound parameter, including the caller's Clerk user id.
 *
 * The first case below asserts the SDK really does leak (so this test fails
 * loudly if a future SDK changes that assumption and the guard becomes
 * theatre). The second asserts our wrapper closes it.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { toolErrorResult } from '../src/lib/serverErrors';

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  ✗ ${name}`); }
  else console.log(`  ✓ ${name}`);
}

const SQL = 'select "id", "clerk_user_id", "email", "deleted_at", "created_at", "updated_at" '
  + 'from "users" "users" where "users"."clerk_user_id" = $1 limit $2';
const CLERK_ID = 'user_TESTONLYnotarealclerkid';

/** Faithful stand-in for drizzle-orm's DrizzleQueryError (see errors.js). */
function drizzleQueryError(): Error {
  const cause = new Error("password authentication failed for user 'neondb_owner'");
  cause.name = 'NeonDbError';
  const err = new Error(`Failed query: ${SQL}\nparams: ${[CLERK_ID, 1]}`, { cause });
  Object.assign(err, { query: SQL, params: [CLERK_ID, 1] });
  return err;
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map(c => c.text ?? '').join('\n');
}

async function main() {
  const server = new McpServer({ name: 'test', version: '0' });

  // The old shape: the tool lets the database error escape.
  server.registerTool('unwrapped', { description: 'x', inputSchema: {} }, async () => {
    throw drizzleQueryError();
  });

  // The shipped shape: withToolAnalytics' catch-all returns instead of throwing.
  server.registerTool('wrapped', { description: 'x', inputSchema: {} }, async () => {
    try {
      throw drizzleQueryError();
    } catch (err) {
      return toolErrorResult('Unhandled exception in wrapped', err);
    }
  });

  const client = new Client({ name: 'test-client', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  // ---- The SDK really does leak a thrown message ------------------------
  const leaked = textOf(await client.callTool({ name: 'unwrapped', arguments: {} }));
  check('BASELINE: a thrown error still reaches the client verbatim (SDK behavior unchanged)',
    leaked.includes('Failed query') && leaked.includes(CLERK_ID));

  // ---- The wrapper closes it -------------------------------------------
  const safeResult = await client.callTool({ name: 'wrapped', arguments: {} });
  const safe = textOf(safeResult);
  console.log(`  … client sees: ${JSON.stringify(safe)}`);
  check('wrapped: no SQL statement reaches the client', !safe.includes('select "id"'));
  check('wrapped: no "Failed query" reaches the client', !safe.includes('Failed query'));
  check('wrapped: no Clerk user id reaches the client', !safe.includes(CLERK_ID));
  check('wrapped: no driver error text reaches the client', !safe.includes('neondb_owner'));
  check('wrapped: still flagged isError for client + directory health metrics',
    (safeResult as { isError?: boolean }).isError === true);
  check('wrapped: message is present and tells the agent retrying is safe',
    safe.length > 20 && /retry/i.test(safe));

  await client.close();
  await server.close();

  if (failures > 0) {
    console.error(`\n✗ MCP tool error exposure: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\n✓ MCP tool error exposure: all checks passed');
}

main().catch(err => { console.error(err); process.exit(1); });
