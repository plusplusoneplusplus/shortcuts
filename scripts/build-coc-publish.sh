#!/usr/bin/env bash
set -euo pipefail

# Build forge and coc, then verify the tarball includes forge.
# Run from the monorepo root: ./scripts/build-coc-publish.sh

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Building all packages..."
npm run build

echo ""
echo "==> Verifying tarball contents (dry-run)..."
cd packages/coc
npm pack --dry-run 2>&1 | tee /dev/stderr | grep -q "node_modules/@plusplusoneplusplus/forge" \
  && echo "" && echo "✅  forge is embedded in the tarball." \
  || { echo "❌  forge was NOT found in the tarball. Check bundledDependencies in package.json."; exit 1; }

echo ""
echo "=== Next steps (manual) ==="
echo "  cd packages/coc"
echo "  npm version patch   # or minor / major"
echo "  npm login            # if needed"
echo "  npm publish"
