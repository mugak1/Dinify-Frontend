#!/bin/bash
# SessionStart hook for Claude Code on the web. Runs synchronously — the session waits
# for it to finish, so origin/main and node_modules are guaranteed ready before the
# agent's first command (no races). Two jobs:
#   1. Keep origin/main fresh so new feature branches are cut from the latest remote
#      main, not a stale local ref (see CLAUDE.md "Branch Base — CRITICAL").
#   2. Install node dependencies on a fresh container so lint/test/build are ready
#      without a manual `npm ci`.
#
# Cost: a one-time ~30-40s wait on a cold container (~1-2s on a warm one, where the
# install is skipped). To trade that determinism for faster startup, switch to async
# by making `{"async": true, "asyncTimeout": 600000}` the first line of output.
set -euo pipefail

# Web (remote container) sessions only — local devs manage their own fetch/install.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# 1) Remote-tracking refresh only: updates refs/remotes/origin/main, never a local
#    branch, so it is safe even with uncommitted work. Tolerate transient errors.
git fetch origin main --quiet 2>/dev/null || true

# 2) Install dependencies on a fresh container; skip when node_modules already exists
#    (warm/cached container). CLAUDE.md mandates --legacy-peer-deps to avoid
#    peer-dependency conflicts.
if [ ! -d node_modules ]; then
  npm ci --legacy-peer-deps
fi
