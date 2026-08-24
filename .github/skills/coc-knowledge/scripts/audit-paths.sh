#!/usr/bin/env bash
# Quarterly path audit for the coc-knowledge KB.
#
# Reference files cite source files as backticked path fragments that are relative to
# whichever package the surrounding section is about (`features/chat/ChatListPane.tsx`,
# `packages/coc/src/server/routes/index.ts`, `Router.tsx`). This resolves each fragment
# as a path suffix against every git-tracked file and reports the ones that match
# nothing, so a file that was renamed or deleted shows up.
#
# Usage: .github/skills/coc-knowledge/scripts/audit-paths.sh [repo-root]
set -uo pipefail
ROOT="${1:-$(git rev-parse --show-toplevel)}"
exec python3 "$(dirname "$0")/audit-paths.py" "$ROOT"
