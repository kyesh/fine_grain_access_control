---
description: Rebuild context after a crashed or interrupted session from compact artifacts and git state, without loading a full transcript
argument-hint: [branch-name|latest]
allowed-tools: Bash(git:*), Bash(ls:*), Bash(head:*), Bash(tail:*), Bash(cat:*), Bash(jq:*), Bash(node:*), Read, Glob, Grep
---

# Recover Session

**Purpose:** Extract the minimum viable context from an interrupted session so work can
continue in a fresh conversation WITHOUT exhausting the context window.

Target: `$1` (a branch name, or `latest` / empty for the most recent work).

> [!CAUTION]
> **NEVER read a full session transcript (`~/.claude/projects/*/[uuid].jsonl`).** Those files
> run to hundreds of KB and will consume most of your context budget, dooming the recovery to
> the same fate. Use the targeted extraction below.
>
> If the previous session is still resumable, `claude --resume` is cheaper than this workflow.
> Use this command when resume isn't available or the transcript is too large to reload.

## Execution Steps

### Step 1: Git state is the ground truth

The git log is the most reliable record of what was actually completed.

```bash
echo "=== Branch ===" && git branch --show-current && \
echo "\n=== Recent commits ===" && git log --oneline -10 && \
echo "\n=== Uncommitted changes ===" && git status --short && \
echo "\n=== Diff stats vs main ===" && git diff --stat main...HEAD 2>/dev/null | tail -5
```

### Step 2: Read the implementation plan for this branch

This project saves versioned plans per branch (see CLAUDE.md). Find the highest revision and
read only its head:

```bash
BR=$(git branch --show-current) && \
ls -1 docs/implementation_plans/ | grep -F "$BR" | sort -V | tail -1
```

Then read the first ~60 lines of that file with `Read` (`limit: 60`) — enough for the goal and
approach. Read further only if you actually need the detail.

### Step 3: Check project memory

```bash
cat ~/.claude/projects/-Users-kyesh-GitRepos-fine-grain-access-control/memory/MEMORY.md 2>/dev/null
```
Read individual memory files only if the index line looks relevant.

### Step 4: Check QA results (if the interruption happened during QA)

```bash
cat docs/QA_Acceptance_Test/qa-results.json 2>/dev/null | node -e "
const r = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('Last QA run:', r.run_id);
console.log('Summary:', r.summary.pass + '/' + r.summary.total, 'pass,', r.summary.fail, 'fail');
r.tests.filter(t => t.status !== 'pass').forEach(t => console.log(' ', t.status.toUpperCase() + ':', t.id, '-', t.name));
" 2>/dev/null || echo "No QA results file found"
```

### Step 5: Locate the stop point (LAST FEW LINES ONLY)

Only if steps 1–4 left you unsure where work stopped. Read the tail of the most recent
transcript — never the whole file:

```bash
LOG=$(ls -t ~/.claude/projects/-Users-kyesh-GitRepos-fine-grain-access-control/*.jsonl 2>/dev/null | head -1) && \
echo "Transcript: $LOG" && tail -5 "$LOG" | node -e "
let buf=''; process.stdin.on('data',d=>buf+=d).on('end',()=>{
  for (const line of buf.split('\n')) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      const c = d.message?.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => b.text || b.name || b.type).join(' ') : '';
      console.log((d.type || '?') + ': ' + String(text).slice(0, 200));
    } catch {}
  }
});" 2>/dev/null || echo "No transcript found"
```

### Step 6: Check the environment is clean before resuming

```bash
echo "Untracked files: $(git status --short | grep '^??' | wc -l)  (should be < 20)" && \
pgrep -fl 'chrome.*playwright_user_data' | head -3 || echo "No stale test-Chrome processes"
```

Kill stale test browsers with `pkill -f 'chrome.*playwright_user_data'` — never plain
`pkill chrome`.

### Step 7: Write the recovery brief

Produce a compact summary and use it as the task list for this conversation:

```markdown
# Recovery Brief

## Branch: [branch-name]

### What's Done
- [Completed items from the git log and plan]

### What's In Progress
- [Uncommitted changes, unfinished plan steps]

### Stop Point
- [Where the session stopped, from Step 5]

### Next Action
- [The specific next thing to do]
```

Register these as tasks, then proceed with the work.

> [!IMPORTANT]
> **Total context budget for recovery: ~5,000 tokens.** Git state ~300, implementation plan
> head ~500, memory index ~200, QA summary ~200, transcript tail ~200. That leaves the rest of
> the window for actual work.

### Step 8: Proceed

**Do NOT go back and read more of the old transcript.** If you need a specific implementation
decision, check the code itself (`Grep`, targeted `Read`) rather than the conversation log.
