#!/bin/bash
# Build VSIX package locally
# Usage: ./scripts/build-vsix.sh

set -e

cd "$(dirname "$0")/.."

echo "Installing dependencies..."
npm install

echo "Building production bundle..."
npm run package

echo "Creating VSIX package..."
npm run vsce:package

echo "Done! VSIX file created in project root."
ls -la *.vsix 2>/dev/null || echo "No VSIX file found - check for errors above."
