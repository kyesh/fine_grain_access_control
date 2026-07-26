/* eslint-disable */
/**
 * `npx tsx scripts/qa-coverage-check.ts` — is every QA assertion accounted for?
 *
 * Parses the assertion inventory from docs/QA_Acceptance_Test/capabilities/NN_*.md
 * (headings of the form `### A<n>: ...`) and diffs it against
 * docs/QA_Acceptance_Test/qa-results.json.
 *
 * Coverage is arithmetic, not judgment — this script does the arithmetic so a
 * model only ever argues about evidence quality. Exits non-zero when anything
 * is unaccounted for, listing exactly what. Run manually, from the Stop hook,
 * or at the end of any /qa-* workflow.
 *
 * qa-results.json schema (documented in docs/QA_Acceptance_Test/README.md):
 * {
 *   "run_id": "2026-07-26T14:00:00Z-cc-mcp",
 *   "environment": "02_claude_code_mcp",
 *   "results": [
 *     { "cap": "01", "assertion": "A1", "status": "pass",
 *       "evidence": "HTTP 403 with whitelist error text" }
 *   ]
 * }
 * status: "pass" | "fail" | "skip". A "skip" requires a "reason". A "pass" or
 * "fail" requires "evidence". Evidence strings must be masked per CLAUDE.md →
 * "This Repository Is Public" (USER_A/USER_B, never real addresses/ids/keys).
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CAPS_DIR = 'docs/QA_Acceptance_Test/capabilities';
const RESULTS_FILE = 'docs/QA_Acceptance_Test/qa-results.json';

type ResultRow = {
  cap?: string;
  assertion?: string;
  status?: string;
  evidence?: string;
  reason?: string;
};

// ── Inventory: capability id → assertion ids ────────────────────────────────
const inventory = new Map<string, Set<string>>();

for (const file of readdirSync(CAPS_DIR).sort()) {
  const m = file.match(/^(\d{2})_.*\.md$/);
  if (!m) continue; // README.md etc.
  const cap = m[1];
  const assertions = new Set<string>();
  for (const line of readFileSync(join(CAPS_DIR, file), 'utf8').split('\n')) {
    const a = line.match(/^###\s+(A\d+)\s*:/);
    if (a) assertions.add(a[1]);
  }
  if (assertions.size > 0) inventory.set(cap, assertions);
}

const totalAssertions = [...inventory.values()].reduce((n, s) => n + s.size, 0);

if (totalAssertions === 0) {
  console.error(`No assertions found under ${CAPS_DIR} — the parser or the docs moved.`);
  process.exit(2);
}

// ── Results ─────────────────────────────────────────────────────────────────
if (!existsSync(RESULTS_FILE)) {
  console.error(`${RESULTS_FILE} not found. Runners must write it (schema in docs/QA_Acceptance_Test/README.md).`);
  process.exit(2);
}

let results: ResultRow[];
let runId = '?', environment = '?';
try {
  const parsed = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'));
  results = parsed.results ?? [];
  runId = parsed.run_id ?? '?';
  environment = parsed.environment ?? '?';
} catch (e) {
  console.error(`${RESULTS_FILE} is not valid JSON: ${(e as Error).message}`);
  process.exit(2);
}

const problems: string[] = [];
const seen = new Map<string, string>(); // "cap/assertion" → status

for (const [i, row] of results.entries()) {
  const key = `${row.cap}/${row.assertion}`;
  if (!row.cap || !row.assertion || !row.status) {
    problems.push(`results[${i}] is missing cap/assertion/status: ${JSON.stringify(row)}`);
    continue;
  }
  if (!inventory.get(row.cap)?.has(row.assertion)) {
    problems.push(`${key}: not in the capability docs (typo, or docs changed?)`);
    continue;
  }
  if (seen.has(key)) {
    problems.push(`${key}: reported twice (${seen.get(key)} then ${row.status})`);
    continue;
  }
  seen.set(key, row.status);

  if (!['pass', 'fail', 'skip'].includes(row.status)) {
    problems.push(`${key}: unknown status "${row.status}" (pass|fail|skip)`);
  } else if (row.status === 'skip' && !row.reason?.trim()) {
    problems.push(`${key}: skipped without a reason — every skip needs one`);
  } else if (row.status !== 'skip' && !row.evidence?.trim()) {
    problems.push(`${key}: ${row.status} with no evidence — cite the observed output`);
  }
}

// Missing assertions.
const missing: string[] = [];
for (const [cap, assertions] of inventory) {
  for (const a of assertions) {
    if (!seen.has(`${cap}/${a}`)) missing.push(`${cap}/${a}`);
  }
}
if (missing.length > 0) {
  problems.push(`Unaccounted-for assertions (${missing.length}): ${missing.join(', ')}`);
}

// ── Report ──────────────────────────────────────────────────────────────────
const counts = { pass: 0, fail: 0, skip: 0 };
for (const status of seen.values()) if (status in counts) counts[status as keyof typeof counts]++;

console.log(`QA coverage — run ${runId} (${environment})`);
console.log(`  inventory: ${totalAssertions} assertions across ${inventory.size} capabilities`);
console.log(`  reported:  ${seen.size}  (pass ${counts.pass} / fail ${counts.fail} / skip ${counts.skip})`);

if (problems.length > 0) {
  console.log(`\nPROBLEMS (${problems.length}):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}

if (counts.fail > 0) {
  console.log('\nCoverage is complete, but there are failures to address.');
  process.exit(0); // coverage is this script's job; failures are the orchestrator's
}

console.log('\nAll assertions accounted for.');
