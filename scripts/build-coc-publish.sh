#!/usr/bin/env bash
set -euo pipefail

# Build forge and coc, then verify the tarball includes forge.
# Run from the monorepo root: ./scripts/build-coc-publish.sh

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Building all packages..."
npm run build:packages

echo ""
echo "==> Staging forge into coc/node_modules for bundling..."
FORGE_NM="packages/coc/node_modules/@plusplusoneplusplus/forge"
rm -rf "$FORGE_NM"
mkdir -p "$(dirname "$FORGE_NM")"
cp -R packages/forge "$FORGE_NM"
rm -rf "$FORGE_NM/node_modules" "$FORGE_NM/.git" "$FORGE_NM/src" "$FORGE_NM/test"

echo ""
echo "==> Packing and verifying tarball..."
cd packages/coc
TARBALL=$(npm pack 2>&1 | tail -1)
if tar tzf "$TARBALL" | grep -q "node_modules/@plusplusoneplusplus/forge"; then
  FORGE_FILES=$(tar tzf "$TARBALL" | grep -c "node_modules/@plusplusoneplusplus/forge")
  echo "✅  forge is embedded in the tarball ($FORGE_FILES files)."
else
  rm -f "$TARBALL"
  echo "❌  forge was NOT found in the tarball. Check bundledDependencies in package.json."
  exit 1
fi
rm -f "$TARBALL"

echo ""
echo "=== Next steps (manual) ==="
echo "  cd packages/coc"
echo "  npm version patch   # or minor / major"
echo "  npm login            # if needed"
echo "  npm publish"
