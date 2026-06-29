// Self-healing native-ABI preflight for the Electron desktop dev loop.
//
// The desktop app runs under Electron, but `npm run dev` (plain Node) and
// `npm run dev:desktop` (Electron) share ONE hoisted `node_modules`. Whichever
// runtime built last left better-sqlite3 / node-pty compiled for its own
// NODE_MODULE_VERSION, so flipping to the other runtime throws:
//
//   "The module '…/better_sqlite3.node' was compiled against a different
//    Node.js version using NODE_MODULE_VERSION 141. This version requires 133."
//
// This script is wired as `predev:desktop`: it PROBES whether the native modules
// already load under Electron's ABI and rebuilds them only when they don't —
// so a warm tree launches with no rebuild cost, and a stale tree self-heals.
//
//   node ensure-native-abi.mjs          # probe, rebuild only if mismatched
//   node ensure-native-abi.mjs --force  # always rebuild (rebuild:native / dist)
//
// Releases never hit this: electron-builder rebuilds against Electron in its own
// clean tree, and the npm-published CLI gets Node-ABI binaries. This is purely a
// dev-from-source convenience for the shared workspace `node_modules`.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    NATIVE_MODULES,
    workspaceRootFrom,
    moduleDir,
    resolveElectronVersion,
    shouldRebuild,
    buildRebuildArgs,
    buildProbeScript,
} from './native-abi.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, '..');
const root = workspaceRootFrom(here);
const force = process.argv.includes('--force');
const require = createRequire(import.meta.url);

function log(msg) {
    console.log(`[ensure-native-abi] ${msg}`);
}

/** Resolve Electron's version and executable path from this package's devDependency. */
function resolveElectron() {
    const electronDir = join(packageDir, 'node_modules', 'electron');
    const electronPkgPath = join(electronDir, 'package.json');
    if (!existsSync(electronPkgPath)) {
        throw new Error(
            `Electron is not installed under ${join(packageDir, 'node_modules')}. Run \`npm install\` first.`,
        );
    }
    const version = resolveElectronVersion(JSON.parse(readFileSync(electronPkgPath, 'utf8')));
    // The electron package's main export resolves to the platform executable path.
    const exe = require(electronDir);
    return { version, exe };
}

/** Resolve the electron-rebuild CLI entry from the workspace-root node_modules. */
function resolveRebuildCli() {
    const cli = join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');
    if (!existsSync(cli)) {
        throw new Error(`@electron/rebuild is not installed at ${cli}. Run \`npm install\` first.`);
    }
    return cli;
}

/** The native modules that are actually present at the workspace root (skip absent ones). */
function presentModules() {
    return NATIVE_MODULES.map((name) => ({ name, dir: moduleDir(root, name) })).filter((m) =>
        existsSync(m.dir),
    );
}

/** Probe: do all present modules load under Electron's ABI? Runs Electron as plain Node. */
function probeLoadsUnderElectron(exe, modules) {
    const script = buildProbeScript(modules.map((m) => m.dir));
    const res = spawnSync(exe, ['-e', script], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'ignore',
    });
    return res.status === 0;
}

function main() {
    const modules = presentModules();
    if (modules.length === 0) {
        log('no native modules found at the workspace root; nothing to rebuild.');
        return;
    }

    const { version, exe } = resolveElectron();

    // Skip the probe entirely when forced — we're going to rebuild regardless.
    const probeOk = force ? false : probeLoadsUnderElectron(exe, modules);
    if (!shouldRebuild({ probeOk, force })) {
        log(`native modules already match Electron ${version} ABI; skipping rebuild.`);
        return;
    }

    const rebuildCli = resolveRebuildCli();
    const names = modules.map((m) => m.name).join(', ');
    log(`rebuilding ${names} for Electron ${version}…`);

    for (const m of modules) {
        const args = buildRebuildArgs({ version, moduleName: m.name, moduleDirPath: m.dir });
        const res = spawnSync(process.execPath, [rebuildCli, ...args], { stdio: 'inherit' });
        if (res.status !== 0) {
            throw new Error(`electron-rebuild failed for ${m.name} (exit ${res.status ?? 'unknown'})`);
        }
    }
    log('native modules are now built for Electron.');
}

try {
    main();
} catch (err) {
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
}
