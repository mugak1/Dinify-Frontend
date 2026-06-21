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

# ── Manual checklist: Reports surface (PR1 — shell + Sales, mock-first) ───────
# The four checks above are the automated gate. After they pass, manually verify
# the Reports hub on the dev server (npm start) at /rest-app/reports:
#   [ ] /rest-app/reports redirects to /rest-app/reports/sales
#   [ ] The date range persists as you switch Sales ↔ Menu ↔ Transactions ↔ Diners
#   [ ] The date range survives a full page reload (localStorage), scoped per restaurant
#   [ ] Default (this-month) shows the daily aggregate + the 50/page listing + totals footer
#   [ ] A custom range > 31 days: aggregate switches to monthly, listing shows the guard
#   [ ] Menu / Transactions / Diners show the "still building this report" state
#   [ ] Sales empty range shows the empty state; a failed load shows error + Try again
#   [ ] >=lg shows the 240px left rail; below lg the list is a horizontal pill selector

# ── Manual checklist: Reports export bar (CSV / XLSX / Print, mock-first) ─────
# The export bar lives in each report's header (title left / bar right). On the
# dev server (npm start) at /rest-app/reports/*, after the automated gate passes:
#   [ ] Each report (Sales/Menu/Transactions/Diners) shows Export XLSX · Export
#       CSV · Print in the header
#   [ ] Export CSV downloads dinify-<report>-<from>_<to>.csv of the PRIMARY table's
#       FULL rows (Sales/Txn/Diners → the per-order listing; Menu → the aggregate),
#       with raw numbers, "(UGX)" in money headers, and a final totals row
#   [ ] Export XLSX downloads the matching .xlsx — numeric cells are real numbers
#       (SUM works), money columns carry "(UGX)" in the header, totals row present
#   [ ] Print opens a clean printable sheet (restaurant · report · range · timestamp
#       + the full table with on-screen formatting + totals) and auto-prints
#   [ ] Exported/printed columns, rows and totals match what is on screen
#   [ ] Sales/Transactions/Diners: a range > 31 days disables the bar with the
#       "pick 31 days or fewer" tooltip; an empty listing disables it with the
#       "nothing to export" tooltip
#   [ ] Menu's bar is enabled whenever it has rows (no 31-day guard)
