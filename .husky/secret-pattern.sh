#!/bin/sh
# Shared forbidden-content pattern for the pre-commit and commit-msg hooks.
# Sourced, not executed — sets FORBIDDEN_PATTERN.
#
# Secrets are just as permanent in a commit message as in a file, so both hooks
# check the same pattern.

# Proxy API keys.
FORBIDDEN_PATTERN="(sk_proxy_[a-fA-F0-9]{15,})"

# Private QA test emails, if the local config is present. The file is
# gitignored, so this silently degrades to the key-only pattern on machines
# that do not have it (CI, fresh clones).
CONFIG_FILE=".qa_test_emails.json"
if [ -f "$CONFIG_FILE" ]; then
  PRIVATE_EMAILS=$(grep -oE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' "$CONFIG_FILE" \
    | tr '\n' '|' | sed 's/|$//' | sed 's/\./\\./g')
  if [ -n "$PRIVATE_EMAILS" ]; then
    FORBIDDEN_PATTERN="(sk_proxy_[a-fA-F0-9]{15,}|$PRIVATE_EMAILS)"
  fi
fi
