#!/usr/bin/env bash
# coverage-diff.sh — Run tests with coverage, then filter LCOV data to only changed files.
#
# Usage: bash scripts/coverage-diff.sh [base_branch]
#   base_branch  Branch to diff against (default: main)
#
# Environment variables:
#   SKIP_TESTS=1  Skip the test re-run and reuse an existing coverage/lcov.info.
#                 Useful when coverage was already produced upstream (e.g., merged
#                 from CI shards) and only the diff-filter step is needed.
#
# Must be run from a package directory (e.g., packages/forge/).
# Produces filtered coverage in coverage/coverage-diff/.

set -euo pipefail

BASE_BRANCH="${1:-main}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
PKG_DIR="$(pwd)"
PKG_REL="${PKG_DIR#"$REPO_ROOT/"}"
COVERAGE_DIR="$PKG_DIR/coverage"
DIFF_DIR="$COVERAGE_DIR/coverage-diff"
LCOV_FULL="$COVERAGE_DIR/lcov.info"
LCOV_FILTERED="$DIFF_DIR/lcov.info"

# Step 1: Run tests with coverage (unless coverage was already produced upstream)
if [ "${SKIP_TESTS:-}" = "1" ]; then
  echo "==> SKIP_TESTS=1, reusing existing $LCOV_FULL..."
else
  echo "==> Running tests with coverage..."
  npx vitest run --coverage
fi

if [ ! -f "$LCOV_FULL" ]; then
  echo "ERROR: $LCOV_FULL not found. Ensure lcov reporter is configured in vitest.config.ts."
  exit 1
fi

# Step 2: Get changed source files relative to base branch
echo "==> Finding changed files vs $BASE_BRANCH..."
CHANGED_FILES=$(git diff --name-only "$BASE_BRANCH" -- "$PKG_REL/src/" 2>/dev/null || true)

if [ -z "$CHANGED_FILES" ]; then
  echo "No changed source files found vs $BASE_BRANCH in $PKG_REL/src/."
  echo "Generating empty diff coverage report."
  mkdir -p "$DIFF_DIR"
  echo "TN:" > "$LCOV_FILTERED"
  echo "end_of_record" >> "$LCOV_FILTERED"
  exit 0
fi

echo "Changed files:"
echo "$CHANGED_FILES" | sed 's/^/  /'

# Step 3: Filter LCOV to only changed files
mkdir -p "$DIFF_DIR"
echo "==> Filtering coverage to changed files..."

# Build grep pattern from changed file paths (convert repo-relative to absolute)
PATTERN=""
while IFS= read -r file; do
  ABS_FILE="$REPO_ROOT/$file"
  if [ -z "$PATTERN" ]; then
    PATTERN="$ABS_FILE"
  else
    PATTERN="$PATTERN|$ABS_FILE"
  fi
done <<< "$CHANGED_FILES"

# Filter LCOV: keep only records whose SF: line matches a changed file
awk -v pattern="$PATTERN" '
BEGIN { keep = 0; split(pattern, files, "|"); }
/^SF:/ {
  keep = 0
  for (i in files) {
    if (index($0, files[i]) > 0) {
      keep = 1
      break
    }
  }
}
keep { print }
/^end_of_record/ { keep = 0 }
' "$LCOV_FULL" > "$LCOV_FILTERED"

# Step 4: Check if any coverage data was captured for changed files
if [ ! -s "$LCOV_FILTERED" ]; then
  echo "WARNING: No coverage data found for changed files."
  echo "The changed files may not be covered by any tests."
  echo "TN:" > "$LCOV_FILTERED"
  echo "end_of_record" >> "$LCOV_FILTERED"
fi

# Step 5: Generate summary
TOTAL_LINES=0
COVERED_LINES=0
while IFS= read -r line; do
  case "$line" in
    LF:*) TOTAL_LINES=$((TOTAL_LINES + ${line#LF:})) ;;
    LH:*) COVERED_LINES=$((COVERED_LINES + ${line#LH:})) ;;
  esac
done < "$LCOV_FILTERED"

if [ "$TOTAL_LINES" -gt 0 ]; then
  PERCENT=$((COVERED_LINES * 100 / TOTAL_LINES))
  echo ""
  echo "==> Diff Coverage Summary"
  echo "    Changed files covered: $COVERED_LINES / $TOTAL_LINES lines ($PERCENT%)"
else
  echo ""
  echo "==> Diff Coverage Summary"
  echo "    No coverable lines in changed files."
fi

echo "==> Filtered LCOV written to: $LCOV_FILTERED"
echo "==> Done."
