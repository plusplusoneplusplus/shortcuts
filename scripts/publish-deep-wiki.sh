#!/bin/bash
# Build, bundle, and publish the deep-wiki package to npm
# Usage: ./scripts/publish-deep-wiki.sh [--dry-run]

set -e

cd "$(dirname "$0")/.."

DRY_RUN=""
if [ "$1" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
  echo "Running in dry-run mode (no actual publish)"
fi

echo "Installing dependencies..."
npm install

echo "Building pipeline-core (dependency)..."
cd packages/pipeline-core
npm run build
cd ../..

echo "Building deep-wiki..."
cd packages/deep-wiki
npm run build

echo "Bundling deep-wiki..."
npm run build:bundle

echo "Running tests..."
npm run test:run

echo "Bumping patch version..."
npm version patch --no-git-tag-version

echo "Publishing deep-wiki..."
npm publish $DRY_RUN

cd ../..
echo "Done!"
