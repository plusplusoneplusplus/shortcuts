/**
 * Copies the built @plusplusoneplusplus/forge package into coc's local
 * node_modules so that `bundledDependencies` actually includes it in the
 * npm tarball.
 *
 * In an npm workspaces monorepo, workspace dependencies are symlinked to the
 * root node_modules — they don't exist in the package's own node_modules.
 * npm pack/publish only bundles from the package-local node_modules directory,
 * so the symlinked forge never makes it into the tarball.
 *
 * This script runs as `prepack` — before `npm pack` or `npm publish`.
 */
const fs = require('fs');
const path = require('path');

const cocRoot = path.resolve(__dirname, '..');
const forgeSource = path.resolve(cocRoot, '..', 'forge');
const forgeDest = path.join(cocRoot, 'node_modules', '@plusplusoneplusplus', 'forge');

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

const forgeDistSrc = path.join(forgeSource, 'dist');
if (!fs.existsSync(forgeDistSrc)) {
  console.error('ERROR: forge dist/ not found. Run "npm run build" in packages/forge first.');
  process.exit(1);
}

const forgePkgSrc = path.join(forgeSource, 'package.json');
if (!fs.existsSync(forgePkgSrc)) {
  console.error('ERROR: forge package.json not found at', forgePkgSrc);
  process.exit(1);
}

if (fs.existsSync(forgeDest)) {
  fs.rmSync(forgeDest, { recursive: true, force: true });
}
fs.mkdirSync(forgeDest, { recursive: true });

copyRecursive(forgeDistSrc, path.join(forgeDest, 'dist'));
fs.copyFileSync(forgePkgSrc, path.join(forgeDest, 'package.json'));

const resourcesSrc = path.join(forgeSource, 'resources');
if (fs.existsSync(resourcesSrc)) {
  copyRecursive(resourcesSrc, path.join(forgeDest, 'resources'));
}

console.log('Bundled @plusplusoneplusplus/forge into coc/node_modules/');
