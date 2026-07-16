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
 *
 * `binding` is the compiled artifact under `build/Release/`, and `exercise`
 * is the probe statement that forces the addon to actually dlopen:
 *
 *   - better-sqlite3 loads its addon LAZILY — `require('better-sqlite3')`
 *     never touches the `.node` file; only `new Database()` does. A bare
 *     require therefore always "passes" the probe even when the compiled ABI
 *     is wrong, and the mismatch only explodes later inside the running app.
 *     The probe must construct (and close) an in-memory database.
 *   - node-pty is N-API based (ABI-stable), and its addon loads eagerly at
 *     require time — a bare require is a real probe, and it only fails when
 *     the build output is missing or broken outright.
 */
export const NATIVE_MODULES = [
    {
        name: 'better-sqlite3',
        binding: 'better_sqlite3.node',
        exercise: (dirExpr) => `{ const M = require(${dirExpr}); new M(':memory:').close(); }`,
    },
    {
        name: 'node-pty',
        binding: 'pty.node',
        exercise: (dirExpr) => `require(${dirExpr});`,
    },
];

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

/** Absolute path to a module's compiled binding under `build/Release/`. */
export function bindingPath(dir, binding) {
    return join(dir, 'build', 'Release', binding);
}

/**
 * Where a compiled binding is stashed per target ABI so flipping between the
 * plain-Node server and the Electron desktop restores a previous build with a
 * file copy instead of a full C++ recompile. Keyed by module version (a new
 * package release invalidates old binaries) and platform/arch (`.node` files
 * are machine-specific; `node_modules/.cache` can survive a platform switch
 * on shared/network checkouts).
 */
export function cachedBindingPath(root, { name, version, abi, platform, arch }) {
    return join(
        root,
        'node_modules',
        '.cache',
        'coc-native-abi',
        `${name}@${version}`,
        `abi-${abi}-${platform}-${arch}`,
    );
}

/**
 * Locate the installed Electron package through Node's resolution algorithm
 * instead of a fixed `node_modules` location.
 *
 * npm hoists this package's `electron` devDependency to the workspace-root
 * `node_modules` whenever nothing at the root conflicts, so
 * `packages/coc-desktop/node_modules/electron` only exists on installs that
 * happen to nest it. Probing that one path reports "Electron is not installed"
 * on a perfectly healthy tree and blocks `dev:desktop` behind a `npm install`
 * that cannot fix it. `requireResolve` is the caller's `require.resolve`, rooted
 * in this package, so the nested and hoisted layouts both resolve.
 */
export function resolveElectronPkgPath(requireResolve) {
    try {
        return requireResolve('electron/package.json');
    } catch {
        throw new Error(
            'Electron could not be resolved from packages/coc-desktop — it is in neither the ' +
                'package-local nor the workspace-root node_modules. Run `npm install` first.',
        );
    }
}

/**
 * The version string electron-rebuild must target. electron-rebuild cannot infer
 * Electron's version here because Electron is a devDependency of this package,
 * not of the workspace-root project it would otherwise scan — so we read it from
 * electron's own package.json and pass it through.
 */
export function resolveElectronVersion(electronPkg) {
    const version = electronPkg?.version;
    if (typeof version !== 'string' || version.length === 0) {
        throw new Error('Could not resolve the installed Electron version');
    }
    return version;
}

/** electron-rebuild CLI args to rebuild a single hoisted module for Electron. */
export function buildRebuildArgs({ version, moduleName, moduleDirPath }) {
    return ['--version', version, '--force', '--only', moduleName, '--module-dir', moduleDirPath];
}

/**
 * The probe script (run via `<runtime> -e`, with `ELECTRON_RUN_AS_NODE=1` when
 * the runtime is Electron). It prints the runtime's ABI, then exercises each
 * module's native addon individually — `exercise` must force the dlopen, not
 * just require the JS entry (see NATIVE_MODULES) — reporting a parseable
 * `OK <name>` / `FAIL <name> <reason>` line per module so the caller can
 * rebuild only what is actually broken. Exit 0 ⇔ every addon loaded.
 * Paths are JSON-stringified so Windows backslashes stay escaped.
 */
export function buildProbeScript(modules) {
    const checks = modules.map(({ name, dir, exercise }) => {
        const attempt = exercise(JSON.stringify(dir));
        return (
            `try { ${attempt} console.log('OK ${name}'); } ` +
            `catch (e) { failed = true; console.log('FAIL ${name} ' + String(e && e.message).split('\\n')[0]); }`
        );
    });
    return (
        `let failed = false; console.log('ABI ' + process.versions.modules); ` +
        checks.join(' ') +
        ` process.exit(failed ? 1 : 0);`
    );
}

/**
 * Parse the probe's stdout into `{ abi, ok, failed }`. `failed` maps module
 * name → first line of the load error. A module missing from the output
 * entirely (probe crashed before reaching it) is treated as failed.
 */
export function parseProbeOutput(stdout, moduleNames) {
    const lines = String(stdout ?? '').split(/\r?\n/);
    let abi = null;
    const ok = [];
    const failed = {};
    for (const line of lines) {
        const abiMatch = line.match(/^ABI (\d+)$/);
        if (abiMatch) {
            abi = abiMatch[1];
            continue;
        }
        const okMatch = line.match(/^OK (\S+)$/);
        if (okMatch && moduleNames.includes(okMatch[1])) {
            ok.push(okMatch[1]);
            continue;
        }
        const failMatch = line.match(/^FAIL (\S+) ?(.*)$/);
        if (failMatch && moduleNames.includes(failMatch[1])) {
            failed[failMatch[1]] = failMatch[2] || 'failed to load';
        }
    }
    for (const name of moduleNames) {
        if (!ok.includes(name) && !(name in failed)) {
            failed[name] = 'no probe result (probe crashed before this module)';
        }
    }
    return { abi, ok, failed };
}
