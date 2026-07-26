#!/bin/bash
# PostToolUse (Edit|Write) reminder: a schema change needs a migration.
#
# Database Rules 4 and 8 are "remember to" rules — this makes the reminder
# mechanical. Fires once per edit of src/db/schema.ts; the tool call already
# ran, so exit 2 only feeds the reminder back to the agent (nothing is
# blocked or undone).
#
# Exit 0 = silent. Exit 2 = stderr is fed back to the agent.

set -uo pipefail

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null || echo "")

case "$FILE" in
  */src/db/schema.ts|src/db/schema.ts)
    echo "REMINDER: src/db/schema.ts changed (Database Rules 1, 4, 8).
Before this branch is done you must:
  1. npm run db:branch    # ensure the isolated Neon branch exists
  2. npm run db:generate  # generate the migration (a new NNNN_*.sql must appear)
  3. npm run db:push      # verify against your local branch
The Stop-time hygiene hook will flag the branch if schema.ts changed with no
new migration file in src/db/migrations/." >&2
    exit 2
    ;;
esac

exit 0
