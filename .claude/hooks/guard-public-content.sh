#!/bin/bash
# PreToolUse guard: never publish customer data to GitHub.
#
# This repository is PUBLIC and open source. Issues, PRs, comments, gists and
# releases are world-readable, and GitHub retains edit history — editing a body
# afterwards does NOT remove what was published. The only real remedy is
# deleting the issue/PR, which is destructive and loses the thread.
#
# Written after a real incident: two production users' email addresses were
# pasted into a public issue while triaging a database problem. The terminal
# report that supplied them was correctly masked; the addresses were re-typed
# unmasked into the issue body.
#
# Exit 0 = allow. Exit 2 = block, stderr is fed back to the agent.

set -uo pipefail

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null || echo "")

[ -z "$CMD" ] && exit 0

# Only guard commands that PUBLISH to GitHub. Reads (view/list/checks) are fine.
printf '%s' "$CMD" | grep -qiE '\bgh[[:space:]]+(issue|pr)[[:space:]]+(create|edit|comment)\b|\bgh[[:space:]]+(gist|release)[[:space:]]+create\b|\bgh[[:space:]]+api\b.*-(f|F)[[:space:]]*body' || exit 0

# ── Collect the text that would be published ───────────────────────────────
# Inline --body/-b text, plus the contents of any --body-file.
CONTENT="$CMD"

BODY_FILES=$(printf '%s' "$CMD" | grep -oE '\-\-body-file[[:space:]]+"?[^"[:space:]]+"?' | sed -E 's/--body-file[[:space:]]+//; s/"//g')
while IFS= read -r f; do
  [ -n "$f" ] && [ -f "$f" ] && CONTENT="$CONTENT
$(cat "$f")"
done <<< "$BODY_FILES"

# ── Email addresses ────────────────────────────────────────────────────────
# Allowlist: the project's own contact address, git noreply addresses, and the
# reserved placeholder domains from RFC 2606. Everything else is treated as a
# real person until proven otherwise.
EMAILS=$(printf '%s' "$CONTENT" \
  | grep -oiE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' \
  | grep -viE '@(example|test|invalid|localhost)\.(com|org|net|edu)?$' \
  | grep -viE '^support@fgac\.ai$|^(noreply|no-reply)@' \
  | grep -viE '@users\.noreply\.github\.com$' \
  | sort -u)

if [ -n "$EMAILS" ]; then
  {
    echo "BLOCKED: this would publish email addresses to a PUBLIC GitHub repository."
    echo ""
    echo "Found:"
    printf '  %s\n' $EMAILS
    echo ""
    echo "GitHub keeps edit history, so removing them afterwards does not undo it."
    echo "Describe the affected records without naming them — point at the local"
    echo "report or query instead, e.g. \"run npm run db:tombstone-orphans -- --prod\"."
    echo "Placeholders on example.com / test.com are fine."
  } >&2
  exit 2
fi

# ── Other customer identifiers ─────────────────────────────────────────────
if printf '%s' "$CONTENT" | grep -qE 'sk_proxy_[a-fA-F0-9]{8,}'; then
  echo "BLOCKED: proxy API key (sk_proxy_...) in content bound for public GitHub." >&2
  exit 2
fi

if printf '%s' "$CONTENT" | grep -qE '\buser_[A-Za-z0-9]{20,}'; then
  {
    echo "BLOCKED: Clerk user id (user_...) in content bound for public GitHub."
    echo "These identify individual customers. Refer to counts or to a local query instead."
  } >&2
  exit 2
fi

exit 0
