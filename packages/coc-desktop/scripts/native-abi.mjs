// Pure, side-effect-free helpers for the Electron native-ABI preflight.
//
// Kept separate from `ensure-native-abi.mjs` so the decision logic is unit
// testable without spawning Electron, electron-rebuild, or touching the disk.
// Importing this module runs nothing — it only exports functions/constants.

import { join, resolve } from 'node:path';

/**
 * The native addons whose compiled `.node` must match the runtime's
 * NODE_MODULE_VERSION. Both are hoisted to the workspace-root `node_modules`,
 * shared by the plain-Node CLI (`coc serve`) and the Electron desktop shell —
 * so they can only be compiled for one ABI at a time, and flipping runtimes
 * forces a rebuild.
 */
export const NATIVE_MODULES = ['better-sqlite3', 'node-pty'];

/**
 * Resolve the workspace root from this `scripts/` directory's location.
 * `packages/coc-desktop/scripts` → repo root is three levels up.
 */
export function workspaceRootFrom(scriptsDir) {
    return resolve(scriptsDir, '..', '..', '..');
}

/** Absolute path to a hoisted native module under the workspace-root `node_modules`. */
export function moduleDir(root, moduleName) {
    return join(root, 'node_modules', moduleName);
}

/**
 * The version string electron-rebuild must target. electron-rebuild cannot infer
 * Electron's version here because Electron is a *nested* devDependency of this
 * package, not a dependency of the workspace-root project it would otherwise
 * scan — so we read it from electron's own package.json and pass it through.
 */
export function resolveElectronVersion(electronPkg) {
    const version = electronPkg?.version;
    if (typeof version !== 'string' || version.length === 0) {
        throw new Error('Could not resolve the installed Electron version');
    }
    return version;
}

/**
 * Decide whether to rebuild. `--force` (used by `rebuild:native`, and by the
 * packaged `build:desktop`) always rebuilds; otherwise we only rebuild when the
 * probe shows the modules do NOT load under Electron's ABI — so a warm dev tree
 * launches with zero rebuild cost.
 */
export function shouldRebuild({ probeOk, force }) {
    if (force) {
        return true;
    }
    return !probeOk;
}

/** electron-rebuild CLI args to rebuild a single hoisted module for Electron. */
export function buildRebuildArgs({ version, moduleName, moduleDirPath }) {
    return ['--version', version, '--force', '--only', moduleName, '--module-dir', moduleDirPath];
}

/**
 * A one-liner Node script (run via `electron -e` with `ELECTRON_RUN_AS_NODE=1`)
 * that `require()`s each module by absolute path. Exit 0 ⇒ every module loads
 * under the current ABI; a non-zero exit ⇒ a NODE_MODULE_VERSION mismatch (or a
 * missing build). Paths are JSON-stringified so Windows backslashes stay escaped.
 */
export function buildProbeScript(modulePaths) {
    return modulePaths.map((p) => `require(${JSON.stringify(p)});`).join('');
}
