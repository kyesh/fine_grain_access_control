---
description: Safely recover from a crashed/interrupted session without loading the full conversation history. Produces a compact recovery brief that fits in ~5K tokens instead of loading 100K+ tokens from the raw log.
---

# Recover Session Workflow (/recover-session)

**Purpose:** Extract the minimum viable context from a crashed session to continue work in a fresh conversation WITHOUT exhausting the context window.

**Trigger:** `/recover-session [conversation-id|latest]`

> [!CAUTION]
> **NEVER read the full `overview.txt` from the crashed session.** That file can be 400KB+ and will immediately consume most of your context budget, dooming this recovery session to the same fate. Use the targeted extraction steps below instead.

## Execution Steps

### Step 1: Identify the crashed session

// turbo

If a conversation ID was provided, use it. Otherwise, find the most recent session:

```bash
# List recent conversations by modification time
ls -lt /home/kyesh/.gemini/antigravity/brain/*/task.md 2>/dev/null | head -5
```

### Step 2: Read ONLY the compact artifacts (NOT the overview.txt)

// turbo

Read these files in priority order. **Stop reading if you have enough context.**

```bash
# Priority 1: Task tracker (smallest, most actionable)
echo "=== TASK.MD ===" && \
cat /home/kyesh/.gemini/antigravity/brain/CONVERSATION_ID/task.md 2>/dev/null | head -100 || echo "No task.md found"
```

```bash
# Priority 2: Walkthrough (if it exists, it's a pre-made summary)
echo "=== WALKTHROUGH.MD ===" && \
cat /home/kyesh/.gemini/antigravity/brain/CONVERSATION_ID/walkthrough.md 2>/dev/null | head -100 || echo "No walkthrough found"
```

```bash
# Priority 3: Implementation plan (only if you need architectural context)
echo "=== IMPLEMENTATION PLAN (first 50 lines only) ===" && \
head -50 /home/kyesh/.gemini/antigravity/brain/CONVERSATION_ID/implementation_plan.md 2>/dev/null || echo "No plan found"
```

### Step 3: Check git state for ground truth

// turbo

The git log is the most reliable record of what was actually completed:

```bash
cd /home/kyesh/GitRepos/fine_grain_access_control && \
echo "=== Branch ===" && git branch --show-current && \
echo "" && echo "=== Recent commits ===" && git log --oneline -10 && \
echo "" && echo "=== Uncommitted changes ===" && git status --short && \
echo "" && echo "=== Diff stats vs main ===" && git diff --stat main...HEAD 2>/dev/null | tail -5
```

### Step 4: Check for QA results (if the crash was during QA)

// turbo

```bash
cat docs/QA_Acceptance_Test/qa-results.json 2>/dev/null | node -e "
const r = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('Last QA run:', r.run_id);
console.log('Summary:', r.summary.pass + '/' + r.summary.total, 'pass,', r.summary.fail, 'fail');
r.tests.filter(t => t.status !== 'pass').forEach(t => console.log(' ', t.status.toUpperCase() + ':', t.id, '-', t.name));
" 2>/dev/null || echo "No QA results file found"
```

### Step 5: Extract the crash point from the overview (LAST 3 LINES ONLY)

// turbo

If you still need to understand exactly where the session stopped, read ONLY the last few lines:

```bash
echo "=== Last 3 entries from crashed session ===" && \
tail -3 /home/kyesh/.gemini/antigravity/brain/CONVERSATION_ID/.system_generated/logs/overview.txt 2>/dev/null | \
python3 -c "
import json, sys
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        print(f\"Step {d.get('step_index','?')}: {d.get('type','?')} - {d.get('content','')[:200]}\")
    except: pass
" 2>/dev/null || echo "No overview found"
```

### Step 6: Write the recovery brief

Create a compact summary of what you learned:

```markdown
# Recovery Brief

## Session: [conversation-id]
## Branch: [branch-name]

### What's Done
- [List completed items from task.md / git log]

### What's In Progress
- [Unchecked items from task.md]

### Crash Point
- [Where the session stopped, from Step 5]

### Next Action
- [The specific next thing to do]
```

Save this as the **task.md for the current conversation**, then proceed with the work.

> [!IMPORTANT]
> **Total context budget for recovery: ~5,000 tokens.** Steps 1-5 should load approximately:
> - task.md: ~500 tokens
> - walkthrough.md first 100 lines: ~800 tokens
> - implementation_plan.md first 50 lines: ~400 tokens
> - git log/status: ~300 tokens
> - QA results summary: ~200 tokens
> - Last 3 overview lines: ~200 tokens
> 
> This leaves ~195K tokens for actual work, vs the previous approach which consumed ~120K tokens just on recovery, leaving only ~80K for work.

### Step 7: Proceed with work

You now have full context from ~2,500 tokens of input. Proceed with the next action identified in the recovery brief.

**Do NOT go back and read more of the old conversation.** If you need specific details about an implementation decision, check the code itself (`grep_search`, targeted `view_file`) rather than the conversation log.
