---
description: Reads QA failure results from the last /qa-runner run and fixes only the failing tests. Designed to be context-efficient — reads only the failures, not the full QA history.
---

# QA Fix Workflow (/qa-fix)

**Purpose:** Read failures from the last QA run, fix the code, and commit. Does NOT re-run tests (use `/qa-runner` for that in a new session).

**Trigger:** `/qa-fix`

## Execution Steps

// turbo

1. **Read only the failures from the results file:**
   ```bash
   node -e "
   const r = JSON.parse(require('fs').readFileSync('docs/QA_Acceptance_Test/qa-results.json'));
   console.log('Run:', r.run_id, '| Branch:', r.branch, '| Target:', r.target);
   console.log('Summary:', r.summary.pass + '/' + r.summary.total, 'pass,', r.summary.fail, 'fail,', r.summary.skip, 'skip');
   console.log('');
   console.log('=== FAILURES ===');
   r.tests.filter(t => t.status === 'fail').forEach(t => {
     console.log('');
     console.log('ID:', t.id);
     console.log('File:', t.file);
     console.log('Test:', t.name);
     console.log('Error:', t.error);
     console.log('Hint:', t.fix_hint || 'none');
   });
   "
   ```

2. **For each failure, read the specific QA test file** to understand what was expected. Only read the specific test section, not the whole file.

3. **Investigate and fix the code.** Use `grep_search` and targeted `view_file` with line ranges to minimize context usage.

4. **After fixing, do NOT re-run the full QA suite in this session.** Instead:
   - Run only a targeted smoke test for the specific fix (e.g., a single curl command)
   - Commit the fix
   - Tell the user to run `/qa-runner [failed-test-id]` in a new session to verify

5. **Update the results file to mark fixes as "fix-pending":**
   ```bash
   node -e "
   const fs = require('fs');
   const r = JSON.parse(fs.readFileSync('docs/QA_Acceptance_Test/qa-results.json'));
   r.tests.filter(t => t.status === 'fail').forEach(t => {
     t.status = 'fix-pending';
     t.fix_commit = require('child_process').execSync('git rev-parse --short HEAD').toString().trim();
   });
   fs.writeFileSync('docs/QA_Acceptance_Test/qa-results.json', JSON.stringify(r, null, 2));
   console.log('Marked', r.tests.filter(t => t.status === 'fix-pending').length, 'tests as fix-pending');
   "
   ```

6. **Commit and hand back:**
   ```bash
   git add -A && git commit -m "fix: address QA failures from run $(node -e "console.log(JSON.parse(require('fs').readFileSync('docs/QA_Acceptance_Test/qa-results.json')).run_id)")"
   ```

> [!TIP]
> The user can now run `/qa-runner [failed-test-ids]` in a new session to verify the fixes. This creates a tight, context-efficient loop:
> `/qa-runner` → failures → `/qa-fix` → fixes → `/qa-runner` → all pass → `/deploy-pr-preview`
