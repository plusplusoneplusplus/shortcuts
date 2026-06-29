#!/usr/bin/env node
// Cross-fetch the Windows better-sqlite3 prebuilt for the installed Electron ABI.
//
// Why this exists: better-sqlite3 is V8/ABI-bound and keeps ONE host binary in
// node_modules/better-sqlite3/build/Release/better_sqlite3.node. electron-builder's
// own native rebuild only targets the HOST OS, so packaging a Windows nsis from
// macOS otherwise bundles the macOS (Mach-O) binary — a Windows installer that
// can't open the database. (node-pty is fine: it ships every platform's prebuild.)
//
// This script downloads the real win32 prebuilt into that slot so a subsequent
// `electron-builder --win ... -c.npmRebuild=false` packs the correct binary.
// Run `npm rebuild better-sqlite3` afterwards to restore the host (CLI) binary.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..'); // packages/coc-desktop
const repoRoot = path.resolve(pkgRoot, '..', '..'); // repo root

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// Electron installs under the package (not hoisted); fall back to the repo root.
const electronPkgPath = [
  path.join(pkgRoot, 'node_modules', 'electron', 'package.json'),
  path.join(repoRoot, 'node_modules', 'electron', 'package.json'),
].find(existsSync);
if (!electronPkgPath) {
  console.error('[fetch-win-sqlite] electron is not installed — run `npm install` first');
  process.exit(1);
}
const electronVersion = readJson(electronPkgPath).version;

const sqliteDir = path.join(repoRoot, 'node_modules', 'better-sqlite3');
const prebuildInstall = path.join(repoRoot, 'node_modules', '.bin', 'prebuild-install');
if (!existsSync(prebuildInstall)) {
  console.error(`[fetch-win-sqlite] prebuild-install not found at ${prebuildInstall}`);
  process.exit(1);
}

const platform = process.env.COC_WIN_PLATFORM || 'win32';
const arch = process.env.COC_WIN_ARCH || 'x64';

console.log(
  `[fetch-win-sqlite] electron ${electronVersion}: fetching better-sqlite3 ${platform}-${arch} prebuilt`,
);
execFileSync(
  prebuildInstall,
  ['-r', 'electron', '-t', electronVersion, '--platform', platform, '--arch', arch, '--tag-prefix', 'v'],
  { cwd: sqliteDir, stdio: 'inherit' },
);
console.log(
  '[fetch-win-sqlite] done — run `npm rebuild better-sqlite3` to restore the host (CLI) binary when finished packaging',
);
