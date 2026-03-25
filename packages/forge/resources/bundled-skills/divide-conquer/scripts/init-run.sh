#!/usr/bin/env bash
# Initialize a divide-conquer run working directory.
# Usage: ./init-run.sh <slug>

set -euo pipefail

SLUG="${1:?Usage: init-run.sh <slug>}"
BASE_DIR="${2:-.divide-conquer}"

# Find repo root
ROOT="$(pwd)"
CURRENT="$ROOT"
while [ "$CURRENT" != "/" ] && [ ! -d "$CURRENT/.git" ]; do
    CURRENT="$(dirname "$CURRENT")"
done
if [ -d "$CURRENT/.git" ]; then
    ROOT="$CURRENT"
fi

BASE_PATH="$ROOT/$BASE_DIR"

# Create base directory
mkdir -p "$BASE_PATH"

# Create .gitignore
if [ ! -f "$BASE_PATH/.gitignore" ]; then
    echo "*" > "$BASE_PATH/.gitignore"
fi

# Create timestamped run directory
TIMESTAMP="$(date +%Y-%m-%d-%H%M%S)"
SAFE_NAME="$(echo "$SLUG" | tr -c 'a-zA-Z0-9-' '-')"
RUN_NAME="${TIMESTAMP}-${SAFE_NAME}"
RUN_PATH="$BASE_PATH/$RUN_NAME"

mkdir -p "$RUN_PATH"

# Write skeleton plan.json
cat > "$RUN_PATH/plan.json" <<EOF
{
  "slug": "$SLUG",
  "createdAt": "$(date -Iseconds)",
  "stages": [],
  "status": "initialized"
}
EOF

# Output run directory path
echo "$RUN_PATH"
