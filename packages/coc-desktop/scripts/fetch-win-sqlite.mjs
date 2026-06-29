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
//
// Importing this module runs nothing — the side-effectful fetch is guarded
// behind the "run as main" check at the bottom, so the pure helpers above can
// be unit tested without spawning a download.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/**
 * Where Electron's package.json might live: installed package-local (not
 * hoisted) first, with a fallback to the workspace-root node_modules.
 */
export function electronPkgCandidates(pkgRoot, repoRoot) {
    return [
        path.join(pkgRoot, 'node_modules', 'electron', 'package.json'),
        path.join(repoRoot, 'node_modules', 'electron', 'package.json'),
    ];
}

/** The Electron version string to target, read from electron's own package.json. */
export function resolveElectronVersion(electronPkg) {
    const version = electronPkg?.version;
    if (typeof version !== 'string' || version.length === 0) {
        throw new Error('Could not resolve the installed Electron version');
    }
    return version;
}

/**
 * Absolute path to prebuild-install's JS entrypoint under the workspace-root
 * node_modules.
 *
 * We target the package's own `bin.js` rather than the `node_modules/.bin/
 * prebuild-install` shim on purpose: on Windows the `.bin` entry is an
 * extensionless shell shim that `execFileSync` cannot spawn without a shell
 * (it throws ENOENT — only `prebuild-install.cmd` is directly runnable). Running
 * `bin.js` with the current Node (`process.execPath`) sidesteps the shim and
 * works identically on every OS.
 */
export function prebuildInstallEntry(repoRoot) {
    return path.join(repoRoot, 'node_modules', 'prebuild-install', 'bin.js');
}

/** Target platform/arch for the prebuilt, overridable for tests/cross-fetch. */
export function resolvePlatformArch(env = {}) {
    return {
        platform: env.COC_WIN_PLATFORM || 'win32',
        arch: env.COC_WIN_ARCH || 'x64',
    };
}

/**
 * Args passed to `process.execPath` (the current Node) to run prebuild-install:
 * the entrypoint first, then the flags that fetch the better-sqlite3 prebuilt
 * for the given Electron ABI and target platform/arch.
 */
export function buildPrebuildArgs({ entry, electronVersion, platform, arch }) {
    return [
        entry,
        '-r',
        'electron',
        '-t',
        electronVersion,
        '--platform',
        platform,
        '--arch',
        arch,
        '--tag-prefix',
        'v',
    ];
}

function main() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgRoot = path.resolve(here, '..'); // packages/coc-desktop
    const repoRoot = path.resolve(pkgRoot, '..', '..'); // repo root

    // Electron installs under the package (not hoisted); fall back to the repo root.
    const electronPkgPath = electronPkgCandidates(pkgRoot, repoRoot).find(existsSync);
    if (!electronPkgPath) {
        console.error('[fetch-win-sqlite] electron is not installed — run `npm install` first');
        process.exit(1);
    }
    const electronVersion = resolveElectronVersion(readJson(electronPkgPath));

    const sqliteDir = path.join(repoRoot, 'node_modules', 'better-sqlite3');
    const entry = prebuildInstallEntry(repoRoot);
    if (!existsSync(entry)) {
        console.error(`[fetch-win-sqlite] prebuild-install not found at ${entry}`);
        process.exit(1);
    }

    const { platform, arch } = resolvePlatformArch(process.env);

    console.log(
        `[fetch-win-sqlite] electron ${electronVersion}: fetching better-sqlite3 ${platform}-${arch} prebuilt`,
    );
    // Spawn via the current Node so the extensionless `.bin` shim is never
    // touched — `execFileSync` on Windows cannot run that shim directly.
    execFileSync(process.execPath, buildPrebuildArgs({ entry, electronVersion, platform, arch }), {
        cwd: sqliteDir,
        stdio: 'inherit',
    });
    console.log(
        '[fetch-win-sqlite] done — run `npm rebuild better-sqlite3` to restore the host (CLI) binary when finished packaging',
    );
}

// Only fetch when invoked directly (`node scripts/fetch-win-sqlite.mjs`); a
// plain `import` for unit tests must not trigger a download.
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main();
}
