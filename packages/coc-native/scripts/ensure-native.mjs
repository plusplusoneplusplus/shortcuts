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
 * When cargo is missing, the script installs rustup's minimal stable toolchain
 * for the current platform and continues in the same process. Set
 * COC_NATIVE_AUTO_INSTALL_RUST=0 on managed or offline machines to require
 * manual provisioning instead.
 *
 * Failure policy is deliberately split on whether a binary already exists: a
 * daemon serving a slightly stale addon beats a daemon that is down, so a
 * failed install or rebuild with a binary on disk warns and exits 0. With no
 * binary there is nothing to fall back to — the server would be dead on first
 * use — so it exits non-zero and fails the caller's build step.
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
import { createHash } from 'node:crypto';
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

    const cargoHome = env.CARGO_HOME || path.join(homedir(), '.cargo');
    const fallback = path.join(cargoHome, 'bin', exe);
    return exists(fallback) ? fallback : null;
}

/** rustup distribution target for a Node platform and architecture. */
export function rustupTarget(platform = process.platform, arch = process.arch) {
    const targets = {
        'darwin-arm64': 'aarch64-apple-darwin',
        'darwin-x64': 'x86_64-apple-darwin',
        'linux-arm64': 'aarch64-unknown-linux-gnu',
        'linux-x64': 'x86_64-unknown-linux-gnu',
        'win32-arm64': 'aarch64-pc-windows-msvc',
        'win32-x64': 'x86_64-pc-windows-msvc',
    };
    return targets[`${platform}-${arch}`] ?? null;
}

/**
 * Install rustup's minimal stable toolchain without modifying shell profiles.
 * Returns the installer exit code; all filesystem and process work is
 * injectable so unattended startup behavior stays unit-testable.
 */
export function installRust(options = {}) {
    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    const target = rustupTarget(platform, arch);
    const logger = options.logger ?? console;
    if (!target) {
        logger.error(`[ensure-native] automatic Rust installation is unsupported on ${platform}-${arch}.`);
        return 1;
    }

    const mkdtemp = options.mkdtemp ?? ((prefix) => fs.mkdtempSync(prefix));
    const chmod = options.chmod ?? ((file, mode) => fs.chmodSync(file, mode));
    const remove = options.remove ?? ((dir) => fs.rmSync(dir, { recursive: true, force: true }));
    const readFile = options.readFile ?? ((file) => fs.readFileSync(file, 'utf8'));
    const sha256 = options.sha256 ?? ((file) =>
        createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
    const run = options.run ?? ((command, args, timeout) => {
        const result = spawnSync(command, args, { stdio: 'inherit', timeout });
        return result.status ?? 1;
    });
    let tempDir = null;

    try {
        tempDir = mkdtemp(path.join(options.tmpdir ?? os.tmpdir(), 'coc-rustup-'));
        const installer = path.join(tempDir, platform === 'win32' ? 'rustup-init.exe' : 'rustup-init');
        const checksum = `${installer}.sha256`;
        const url = `https://static.rust-lang.org/rustup/dist/${target}/${path.basename(installer)}`;
        const curlArgs = (output, source) => [
            '--proto', '=https',
            '--tlsv1.2',
            '--fail',
            '--location',
            '--silent',
            '--show-error',
            '--connect-timeout', '15',
            '--max-time', '300',
            '--output', output,
            source,
        ];

        logger.log(`[ensure-native] cargo not found; downloading the Rust installer for ${target}…`);
        const downloadStatus = run('curl', curlArgs(installer, url), 310_000);
        if (downloadStatus !== 0) {
            logger.error(`[ensure-native] failed to download rustup-init (curl exit ${downloadStatus}).`);
            return downloadStatus;
        }
        const checksumStatus = run('curl', curlArgs(checksum, `${url}.sha256`), 310_000);
        if (checksumStatus !== 0) {
            logger.error(`[ensure-native] failed to download the rustup-init checksum (curl exit ${checksumStatus}).`);
            return checksumStatus;
        }

        const expectedHash = readFile(checksum).trim().split(/\s+/)[0]?.toLowerCase();
        const actualHash = sha256(installer).toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(expectedHash) || actualHash !== expectedHash) {
            logger.error('[ensure-native] rustup-init checksum verification failed; refusing to execute it.');
            return 1;
        }

        if (platform !== 'win32') {
            chmod(installer, 0o755);
        }
        const installStatus = run(
            installer,
            ['-y', '--profile', 'minimal', '--no-modify-path'],
            900_000,
        );
        if (installStatus !== 0) {
            logger.error(`[ensure-native] rustup-init failed with exit ${installStatus}.`);
        }
        return installStatus;
    } catch (error) {
        logger.error(
            `[ensure-native] automatic Rust installation failed: ` +
                `${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
    } finally {
        if (tempDir) {
            try {
                remove(tempDir);
            } catch (error) {
                logger.warn(
                    `[ensure-native] could not remove temporary Rust installer directory ${tempDir}: ` +
                        `${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
    }
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
    const runInstallRust = options.installRust ?? (() => installRust({ logger: options.logger }));
    const runBuild = options.runBuild ?? defaultRunBuild;
    const logger = options.logger ?? console;
    const autoInstallRust =
        options.autoInstallRust ??
        !/^(0|false|no|off)$/i.test(process.env.COC_NATIVE_AUTO_INSTALL_RUST ?? '');
    const staleness =
        options.checkStale ?? ((b, r) => checkStaleness(b, r, { exists }));

    const { stale, reason } = staleness(binaryPath, rustDir);
    if (!stale) {
        // Silent on purpose: this runs on every daemon restart.
        return 0;
    }

    const haveBinary = exists(binaryPath);

    let cargo = findCargo();
    if (!cargo) {
        if (autoInstallRust) {
            let installStatus;
            try {
                installStatus = runInstallRust();
            } catch (error) {
                logger.error(
                    `[ensure-native] automatic Rust installation failed: ` +
                        `${error instanceof Error ? error.message : String(error)}`,
                );
                installStatus = 1;
            }
            if (installStatus === 0) {
                cargo = findCargo();
            }
        }

        if (!cargo) {
            const installHint = autoInstallRust
                ? 'Automatic Rust installation did not produce cargo.'
                : 'Automatic Rust installation is disabled by COC_NATIVE_AUTO_INSTALL_RUST=0.';
            if (haveBinary) {
                logger.warn(
                    `[ensure-native] ${installHint} Keeping the existing addon, which is out of date ` +
                        `(${reason}). Install Rust from https://rustup.rs to refresh it.`,
                );
                return 0;
            }
            logger.error(
                `[ensure-native] ${installHint} ${path.basename(binaryPath)} has never been built, ` +
                    `so the server cannot start. Install Rust from https://rustup.rs and re-run the build.`,
            );
            return 1;
        }
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
            `quick-open, notes-search or git-sync call, so the build stops here.` +
            (process.platform === 'win32'
                ? ' Windows native builds also require the Visual Studio C++ Build Tools and Windows SDK.'
                : ''),
    );
    return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = ensureNative();
}
