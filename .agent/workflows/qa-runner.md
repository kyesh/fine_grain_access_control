---
description: Runs QA acceptance tests and records results to a file. Designed for the automated QA/Fix feedback loop — QA sessions produce structured results, Fix sessions consume only the failures. Use `/qa-runner` to run tests, then start a new conversation with `/qa-fix` to fix failures.
---

# QA Runner Workflow (/qa-runner)

**Purpose:** Run QA acceptance tests and produce a **structured results file** on disk, NOT held in context. This enables the QA/Fix feedback loop across separate sessions without context window exhaustion.

**Trigger:** `/qa-runner [test-id|all] [--target=local|preview]`

## Architecture: The QA/Fix Feedback Loop

```
Session 1: /qa-runner           Session 2: /qa-fix                Session 3: /qa-runner
┌──────────────────┐            ┌──────────────────┐              ┌──────────────────┐
│ Run QA tests     │            │ Read ONLY fails   │              │ Re-run failed     │
│ Write results to │──────────▶ │ from results file │──────────▶   │ tests to verify   │
│ qa-results.json  │            │ Fix the code      │              │ fixes worked      │
│                  │            │ Commit fixes      │              │                   │
└──────────────────┘            └──────────────────┘              └──────────────────┘
                    (file on disk)                   (git commits)
```

**Key principle:** Results live on DISK (`docs/QA_Acceptance_Test/qa-results.json`), not in conversation context. Each session reads/writes the minimal data it needs.

## Results File Format

All results are written to `docs/QA_Acceptance_Test/qa-results.json`:

```json
{
  "run_id": "2026-05-10T04:50:00Z",
  "branch": "feature/skill-distribution-packaging",
  "target": "local:3000",
  "summary": { "total": 15, "pass": 12, "fail": 2, "skip": 1 },
  "tests": [
    {
      "id": "11a.1",
      "file": "11a_mcp_server_protocol.md",
      "name": "MCP Endpoint Discovery",
      "status": "pass",
      "notes": "All 3 expected fields present"
    },
    {
      "id": "11a.6",
      "file": "11a_mcp_server_protocol.md",
      "name": "Blocked Agent Rejected",
      "status": "fail",
      "error": "Got 500 instead of blocked message. Transient DB error.",
      "fix_hint": "Check Neon connection stability or add retry logic"
    }
  ]
}
```

## Execution Steps

### Phase 1: Setup

// turbo

1. **Check prerequisites:**
   ```bash
   echo "=== QA Runner Setup ===" && \
   cd /home/kyesh/GitRepos/fine_grain_access_control && \
   echo "Branch: $(git branch --show-current)" && \
   echo "Uncommitted: $(git status --short | wc -l) files" && \
   echo "Dev server: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ 2>/dev/null || echo 'DOWN')" && \
   echo "Chrome CDP: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:9222/json/version 2>/dev/null || echo 'DOWN')"
   ```

2. **Start dev server if needed** (skip if targeting a preview URL):
   ```bash
   npm run dev 2>&1
   ```

3. **Initialize the results file:**
   ```bash
   node -e "
   const fs = require('fs');
   const results = {
     run_id: new Date().toISOString(),
     branch: require('child_process').execSync('git branch --show-current').toString().trim(),
     target: 'local:3000',
     summary: { total: 0, pass: 0, fail: 0, skip: 0 },
     tests: []
   };
   fs.writeFileSync('docs/QA_Acceptance_Test/qa-results.json', JSON.stringify(results, null, 2));
   console.log('Results file initialized:', results.run_id);
   "
   ```

### Phase 2: Run Tests

For each test, follow this pattern to **minimize context usage**:

> [!IMPORTANT]
> **Context budget rules for QA execution:**
> - NEVER read the full QA test file into context if you've already read it in this session
> - ALWAYS pipe Playwright snapshots through `grep` to extract only the relevant elements
> - ALWAYS use `--no-buffer` with curl for MCP/SSE endpoints
> - ALWAYS write results to the JSON file after EACH test, not at the end
> - If a test requires browser interaction, limit to 3 snapshots max per test
> - Use `OutputCharacterCount: 500` for command_status calls unless you need more

4. **Run each test and record the result immediately:**

   ```bash
   # After running a test, record the result:
   node -e "
   const fs = require('fs');
   const results = JSON.parse(fs.readFileSync('docs/QA_Acceptance_Test/qa-results.json'));
   results.tests.push({
     id: '$TEST_ID',
     file: '$TEST_FILE',
     name: '$TEST_NAME',
     status: '$STATUS',  // 'pass', 'fail', or 'skip'
     notes: '$NOTES',
     error: '$ERROR_IF_FAIL',
     fix_hint: '$HINT_IF_FAIL'
   });
   results.summary.total++;
   results.summary['$STATUS']++;
   fs.writeFileSync('docs/QA_Acceptance_Test/qa-results.json', JSON.stringify(results, null, 2));
   console.log('Recorded: $TEST_ID = $STATUS');
   "
   ```

5. **After all tests, print the summary (not the full results):**
   ```bash
   node -e "
   const r = JSON.parse(require('fs').readFileSync('docs/QA_Acceptance_Test/qa-results.json'));
   console.log('=== QA Run Complete ===');
   console.log('Total:', r.summary.total, '| Pass:', r.summary.pass, '| Fail:', r.summary.fail, '| Skip:', r.summary.skip);
   r.tests.filter(t => t.status === 'fail').forEach(t => console.log('  FAIL:', t.id, '-', t.name, ':', t.error));
   "
   ```

### Phase 3: Handoff

6. **Commit the results file:**
   ```bash
   git add docs/QA_Acceptance_Test/qa-results.json && \
   git commit -m "qa: test run results — $(node -e "const r=JSON.parse(require('fs').readFileSync('docs/QA_Acceptance_Test/qa-results.json'));console.log(r.summary.pass+'/'+r.summary.total+' pass, '+r.summary.fail+' fail')")"
   ```

7. **Tell the user to start a new conversation with `/qa-fix` if there are failures.**

> [!CAUTION]
> **Do NOT attempt to fix failures in this same session.** The QA run consumes significant context from browser snapshots and command outputs. Fixing in the same session risks another crash. Start a fresh `/qa-fix` session instead.
