#!/usr/bin/env bash
#
# scripts/verify.sh — local pre-PR verification for the Dinify frontend.
#
# Runs the same checks as CI (.github/workflows/ci.yml), in the same order.
# This script is the single committed source of truth for these checks; if a
# command changes, change it here (and CI).
#
#   1. type-check   (tsc --noEmit)
#   2. lint         (ng lint)
#   3. test         (ng test, headless single run)
#   4. build:prod   (ng build --configuration=production)
#
# This is a manual, post-change pre-PR gate — run it after making changes and
# paste the output into the PR. It is intentionally NOT wired as a hook.
#
#   ./scripts/verify.sh
#
# Every step runs even if an earlier one fails, so you see all problems at
# once; the script exits non-zero if any step failed. Assumes dependencies are
# installed (npm ci --legacy-peer-deps).

set -uo pipefail

# Run from the repo root regardless of where the script is invoked from.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

failures=()

run_step() {
  local label="$1"; shift
  echo
  echo "=================================================================="
  echo ">>> ${label}"
  echo "=================================================================="
  if "$@"; then
    echo "--- ${label}: PASS"
  else
    echo "--- ${label}: FAIL"
    failures+=("${label}")
  fi
}

run_step "type-check" npm run type-check
run_step "lint"       npm run lint
run_step "test"       npm run test:ci
run_step "build:prod" npm run build:prod

echo
echo "=================================================================="
if [ "${#failures[@]}" -eq 0 ]; then
  echo "All checks passed."
  exit 0
fi
echo "FAILED: ${failures[*]}"
echo "Fix the above before opening a PR."
exit 1
