/**
 * Keep the compiled Rust addon in step with `rust/` — a stale check in front of
 * `build-native.mjs`.
 *
 * The serve loop (`scripts/coc-serve-loop.sh` / `.ps1`) rebuilds on every
 * restart with `npm install` + `npm run coc:link`, and neither touches cargo.
 * Nothing else in the local build path does either: `npm run build` for this
 * package is plain `tsc` on purpose, so the TypeScript build never needs a Rust
 * toolchain. That left the `.node` binary as something you only ever got by
 * hand — a fresh clone had none at all, and the loader treats a missing addon
 * as fatal (`NativeAddonLoadError`), so the server died on the first quick-open
 * / notes-search / git-sync call.
 *
 * This script closes that gap without putting cargo on the `tsc` path:
 *
 *   node scripts/ensure-native.mjs
 *
 * Fresh tree → exits 0 having run nothing. That is the common case on every
 * single restart, so it must stay a few stat() calls and no cargo invocation.
 *
 * Failure policy is deliberately split on whether a binary already exists:
 * a daemon serving a slightly stale addon beats a daemon that is down, so a
 * failed rebuild (or a missing cargo) with a binary on disk warns and exits 0.
 * With no binary there is nothing to fall back to — the server would be dead on
 * first use — so it exits non-zero and fails the caller's build step.
 *
 * Heads up: `build-native.mjs` also rewrites the COMMITTED
 * `src/native-bindings.ts`. Running it from the daemon loop can therefore dirty
 * the working tree. Normally the regenerated file is byte-identical to what is
 * committed (that is exactly what CI asserts), so this is invisible — but if
 * the `#[napi]` surface changed, expect the service to leave a modified file
 * behind.
 *
 * No hashbang on purpose — same reason as `build-native.mjs`: `ensure-native.test.ts`
 * imports these helpers, and Vitest inlines a project-local `.mjs` without an
 * esbuild pass, stripping a leading `#!` only with the LF-only regex
 * `/^#!.*\n/`. On a CRLF checkout the `#!` would land inside the module wrapper
 * and the suite would die at import.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { nativeBinaryName } from './build-native.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The Rust sources whose mtimes decide whether the addon is stale. */
export const RUST_DIR = path.join(packageRoot, 'rust');

/** Directories never worth walking: cargo's own output is newer than every build. */
const SKIPPED_DIRS = new Set(['target', 'node_modules', '.git']);

/** Absolute path of the addon the loader would pick up on this platform. */
export function nativeBinaryPath(root = packageRoot) {
    return path.join(root, nativeBinaryName());
}

/**
 * Every file under `dir` that a rebuild should react to — `.rs` sources plus
 * `Cargo.toml` / `Cargo.lock` / `rustfmt.toml`, i.e. everything except build
 * output. `target/` is excluded because cargo writes it during the very build
 * we are gating on; counting it would make the tree permanently stale.
 */
export function listRustSources(dir, deps = {}) {
    const readdir = deps.readdir ?? ((d) => fs.readdirSync(d, { withFileTypes: true }));
    const found = [];
    const pending = [dir];

    while (pending.length > 0) {
        const current = pending.pop();
        let entries;
        try {
            entries = readdir(current);
        } catch {
            // A missing or unreadable subtree is not a reason to rebuild.
            continue;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (!SKIPPED_DIRS.has(entry.name)) {
                    pending.push(path.join(current, entry.name));
                }
            } else {
                found.push(path.join(current, entry.name));
            }
        }
    }

    return found;
}

/**
 * Is the compiled addon behind its sources? Missing binary counts as stale.
 * Returns the reason too, so the log says why a restart paid for a rebuild.
 */
export function checkStaleness(binaryPath, rustDir, deps = {}) {
    const exists = deps.exists ?? ((p) => fs.existsSync(p));
    const mtimeOf = deps.mtimeOf ?? ((p) => fs.statSync(p).mtimeMs);
    const sourcesOf = deps.listSources ?? ((d) => listRustSources(d, deps));

    if (!exists(binaryPath)) {
        return { stale: true, reason: `${path.basename(binaryPath)} is not built` };
    }

    const binaryMtime = mtimeOf(binaryPath);
    for (const source of sourcesOf(rustDir)) {
        let sourceMtime;
        try {
            sourceMtime = mtimeOf(source);
        } catch {
            continue;
        }
        if (sourceMtime > binaryMtime) {
            return { stale: true, reason: `${path.relative(packageRoot, source)} is newer than the addon` };
        }
    }

    return { stale: false, reason: 'addon is newer than every Rust source' };
}

/**
 * Locate cargo: whatever is on `PATH` first, then rustup's default install
 * location. The second lane matters because the systemd daemon runs with a
 * pinned `PATH` that does not include `~/.cargo/bin`.
 */
export function resolveCargo(deps = {}) {
    const env = deps.env ?? process.env;
    const exists = deps.exists ?? ((p) => fs.existsSync(p));
    const platform = deps.platform ?? process.platform;
    const homedir = deps.homedir ?? (() => os.homedir());
    const exe = platform === 'win32' ? 'cargo.exe' : 'cargo';

    for (const dir of (env.PATH ?? '').split(path.delimiter)) {
        if (!dir) continue;
        const candidate = path.join(dir, exe);
        if (exists(candidate)) {
            return candidate;
        }
    }

    const fallback = path.join(homedir(), '.cargo', 'bin', exe);
    return exists(fallback) ? fallback : null;
}

/** Run `build-native.mjs`, with cargo's directory prepended to `PATH`. */
function defaultRunBuild(cargoPath) {
    const script = path.join(packageRoot, 'scripts', 'build-native.mjs');
    const env = { ...process.env };
    env.PATH = [path.dirname(cargoPath), env.PATH ?? ''].filter(Boolean).join(path.delimiter);
    const result = spawnSync(process.execPath, [script], {
        cwd: packageRoot,
        stdio: 'inherit',
        env,
    });
    return result.status ?? 1;
}

/**
 * The whole decision, injectable end to end. Returns the process exit code.
 */
export function ensureNative(options = {}) {
    const binaryPath = options.binaryPath ?? nativeBinaryPath();
    const rustDir = options.rustDir ?? RUST_DIR;
    const exists = options.exists ?? ((p) => fs.existsSync(p));
    const findCargo = options.findCargo ?? (() => resolveCargo());
    const runBuild = options.runBuild ?? defaultRunBuild;
    const logger = options.logger ?? console;
    const staleness =
        options.checkStale ?? ((b, r) => checkStaleness(b, r, { exists }));

    const { stale, reason } = staleness(binaryPath, rustDir);
    if (!stale) {
        // Silent on purpose: this runs on every daemon restart.
        return 0;
    }

    const haveBinary = exists(binaryPath);

    const cargo = findCargo();
    if (!cargo) {
        if (haveBinary) {
            logger.warn(
                `[ensure-native] cargo not found on PATH or in ~/.cargo/bin — keeping the existing addon, ` +
                    `which is out of date (${reason}). Install Rust or add ~/.cargo/bin to PATH to refresh it.`,
            );
            return 0;
        }
        logger.error(
            `[ensure-native] cargo not found on PATH or in ~/.cargo/bin, and ${path.basename(binaryPath)} ` +
                `has never been built. The server cannot start without it. ` +
                `Install Rust (https://rustup.rs) or add ~/.cargo/bin to PATH, then re-run the build.`,
        );
        return 1;
    }

    logger.log(`[ensure-native] rebuilding the Rust addon (${reason})…`);
    const status = runBuild(cargo);
    if (status === 0) {
        return 0;
    }

    if (haveBinary) {
        logger.warn(
            `[ensure-native] WARNING: the Rust addon failed to build (exit ${status}). ` +
                `Continuing with the existing, out-of-date ${path.basename(binaryPath)} — ` +
                `native behaviour may not match the current sources. Fix the build and restart.`,
        );
        return 0;
    }

    logger.error(
        `[ensure-native] the Rust addon failed to build (exit ${status}) and no ` +
            `${path.basename(binaryPath)} exists to fall back on. The server would fail on the first ` +
            `quick-open, notes-search or git-sync call, so the build stops here.`,
    );
    return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = ensureNative();
}
