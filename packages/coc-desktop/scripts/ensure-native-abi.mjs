// Self-healing native-ABI preflight for the Electron desktop dev loop.
//
// The desktop app runs under Electron, but the plain-Node server (`coc serve`)
// and `npm run dev:desktop` (Electron) share ONE hoisted `node_modules`.
// Whichever runtime built last left better-sqlite3 compiled for its own
// NODE_MODULE_VERSION, so flipping to the other runtime throws:
//
//   "The module '…/better_sqlite3.node' was compiled against a different
//    Node.js version using NODE_MODULE_VERSION 141. This version requires 133."
//
// This script is wired as coc-desktop's `prestart`: it PROBES whether the
// native addons actually dlopen under the target runtime's ABI and heals only
// the ones that don't — so a warm tree launches with no rebuild cost, and a
// stale tree self-heals. The probe must EXERCISE each addon (better-sqlite3
// loads its `.node` lazily inside `new Database()`, so a bare require passes
// even when the compiled ABI is wrong — see NATIVE_MODULES).
//
// Healing prefers a cached binary over a recompile: every good build is
// stashed per-ABI under `node_modules/.cache/coc-native-abi/`, so flipping
// between the Node server and the Electron desktop is a file copy after the
// first compile of each flavor.
//
//   node ensure-native-abi.mjs                 # probe under Electron, heal if broken
//   node ensure-native-abi.mjs --runtime=node  # same, for the plain-Node server
//   node ensure-native-abi.mjs --force         # always recompile (rebuild:native / dist)
//
// The tagged release never hits this: CI runs electron-builder (`dist:mac` /
// `dist:win`) directly, which rebuilds against Electron in its own clean tree,
// and the npm-published CLI gets Node-ABI binaries. Local `build:desktop` does
// run it, via `rebuild:native` ahead of `dist`.
//
// Electron must stay within the ABI range better-sqlite3 ships a prebuilt for,
// or the rebuild below fails to compile — see the ABI pact in
// `test/native-abi.test.ts` before bumping Electron.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    NATIVE_MODULES,
    workspaceRootFrom,
    moduleDir,
    bindingPath,
    cachedBindingPath,
    resolveElectronPkgPath,
    resolveElectronVersion,
    buildRebuildArgs,
    buildProbeScript,
    parseProbeOutput,
} from './native-abi.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = workspaceRootFrom(here);
const force = process.argv.includes('--force');
const runtimeArg = process.argv.find((a) => a.startsWith('--runtime='));
const runtime = runtimeArg ? runtimeArg.split('=')[1] : 'electron';
const require = createRequire(import.meta.url);

if (runtime !== 'electron' && runtime !== 'node') {
    console.error(`[ensure-native-abi] unknown --runtime=${runtime} (expected electron|node)`);
    process.exit(1);
}

function log(msg) {
    console.log(`[ensure-native-abi] ${msg}`);
}

/** Resolve Electron's version and executable path from this package's devDependency. */
function resolveElectron() {
    // Resolved, not path-joined: npm may hoist electron to the workspace root.
    const electronPkgPath = resolveElectronPkgPath((spec) => require.resolve(spec));
    const electronDir = dirname(electronPkgPath);
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

/** The native modules actually present at the workspace root (skip absent ones). */
function presentModules() {
    return NATIVE_MODULES.map((m) => {
        const dir = moduleDir(root, m.name);
        return { ...m, dir };
    }).filter((m) => existsSync(m.dir));
}

/** Installed version of a hoisted module — part of the binary-cache key. */
function moduleVersion(dir) {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version ?? 'unknown';
}

/** Probe: exercise each addon under the target runtime; returns { abi, ok, failed }. */
function probe(exe, env, modules) {
    const script = buildProbeScript(modules);
    const res = spawnSync(exe, ['-e', script], { env, encoding: 'utf8' });
    return parseProbeOutput(
        res.stdout,
        modules.map((m) => m.name),
    );
}

/** Cache location for one module's binding under the target ABI. */
function cacheFileFor(m, abi) {
    const dir = cachedBindingPath(root, {
        name: m.name,
        version: moduleVersion(m.dir),
        abi,
        platform: process.platform,
        arch: process.arch,
    });
    return join(dir, m.binding);
}

/** Stash a module's freshly-verified binding so a later flip back is a file copy. */
function stashBinding(m, abi, { overwrite }) {
    const src = bindingPath(m.dir, m.binding);
    if (!existsSync(src) || abi == null) {
        return;
    }
    const dest = cacheFileFor(m, abi);
    if (!overwrite && existsSync(dest)) {
        return;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
}

/** Restore a cached binding for the target ABI. Returns true when a copy happened. */
function restoreBinding(m, abi) {
    if (abi == null) {
        return false;
    }
    const cached = cacheFileFor(m, abi);
    if (!existsSync(cached)) {
        return false;
    }
    const dest = bindingPath(m.dir, m.binding);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(cached, dest);
    return true;
}

/** Recompile one module for the target runtime (electron-rebuild or npm rebuild). */
function rebuildModule(m) {
    if (runtime === 'electron') {
        const { version } = resolveElectron();
        const args = buildRebuildArgs({
            version,
            moduleName: m.name,
            moduleDirPath: m.dir,
        });
        const res = spawnSync(process.execPath, [resolveRebuildCli(), ...args], {
            stdio: 'inherit',
        });
        if (res.status !== 0) {
            throw new Error(`electron-rebuild failed for ${m.name} (exit ${res.status ?? 'unknown'})`);
        }
        return;
    }
    // Plain-Node flavor: npm rebuild compiles against the current Node's headers.
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const res = spawnSync(npm, ['rebuild', m.name], {
        cwd: root,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    if (res.status !== 0) {
        throw new Error(`npm rebuild failed for ${m.name} (exit ${res.status ?? 'unknown'})`);
    }
}

function main() {
    const modules = presentModules();
    if (modules.length === 0) {
        log('no native modules found at the workspace root; nothing to rebuild.');
        return;
    }

    let exe = process.execPath;
    let env = process.env;
    let runtimeLabel = `Node ${process.versions.node}`;
    if (runtime === 'electron') {
        const electron = resolveElectron();
        exe = electron.exe;
        env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
        runtimeLabel = `Electron ${electron.version}`;
    }

    const first = probe(exe, env, modules);
    const broken = modules.filter((m) => (force ? true : m.name in first.failed));

    if (broken.length === 0) {
        log(`native modules already match ${runtimeLabel} ABI (${first.abi}); skipping rebuild.`);
        for (const m of modules) {
            stashBinding(m, first.abi, { overwrite: false });
        }
        return;
    }

    for (const m of broken) {
        if (force ? false : restoreBinding(m, first.abi)) {
            log(`${m.name}: restored cached ${runtimeLabel} ABI-${first.abi} build (no recompile).`);
        } else {
            const reason = force ? 'forced' : first.failed[m.name];
            log(`${m.name}: rebuilding for ${runtimeLabel} (${reason})…`);
            rebuildModule(m);
        }
    }

    // Verify the healed tree actually loads before declaring success.
    const final = probe(exe, env, modules);
    const stillBroken = Object.entries(final.failed);
    if (stillBroken.length > 0) {
        const detail = stillBroken.map(([name, why]) => `${name}: ${why}`).join('; ');
        throw new Error(`native modules still fail to load after rebuild — ${detail}`);
    }

    for (const m of modules) {
        stashBinding(m, final.abi, { overwrite: broken.includes(m) });
    }
    log(`native modules are now built for ${runtimeLabel}.`);
}

try {
    main();
} catch (err) {
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
}
