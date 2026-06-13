#!/bin/bash
# SessionStart hook — keep origin/main fresh.
#
# Claude Code on the web clones the repo fresh per session, and the local `main`
# ref can lag behind the real remote. Refreshing the remote-tracking ref here lets
# new feature branches be cut from an up-to-date `origin/main` instead of a stale
# local one. See CLAUDE.md "Branch Base — CRITICAL".
set -euo pipefail

# Web (remote container) sessions only — local devs manage their own fetching.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Remote-tracking refresh only: updates refs/remotes/origin/main, never a local
# branch, so it is safe even with uncommitted work. Tolerate transient network
# errors so a fetch hiccup can never block session startup.
git fetch origin main --quiet 2>/dev/null || true
