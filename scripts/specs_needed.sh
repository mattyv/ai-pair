#!/bin/bash
# Prints false only when a nonempty diff consists entirely of test files.
set -u

changes="$(git diff --no-renames --name-only "$1" "$2" -- 2>/dev/null)" || {
  echo true
  exit 0
}
if [[ -z "${changes}" ]]; then
  echo true
  exit 0
fi
while IFS= read -r path; do
  case "${path}" in
    packages/*/test/*.test.ts | packages/*/test/*.test.mts | scripts/test/*.bats)
      ;;
    *)
      echo true
      exit 0
      ;;
  esac
done <<<"${changes}"
echo false
