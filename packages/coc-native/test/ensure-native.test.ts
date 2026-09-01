/**
 * The stale check that keeps the daemon's addon in step with `rust/`.
 *
 * Every branch here is a decision the serve loop makes unattended on restart,
 * so they are driven through injected filesystem/cargo/build stubs rather than
 * a real toolchain — the suite has to pass on a machine with no Rust at all.
 */

import * as path from 'path';
import { describe, expect, it } from 'vitest';

// @ts-expect-error — a .mjs build script with no type declarations.
import {
    checkStaleness,
    ensureNative,
    installRust,
    listRustSources,
    resolveCargo,
    rustupTarget,
} from '../scripts/ensure-native.mjs';

const BINARY = '/pkg/coc-native.linux-x64-gnu.node';
const RUST = '/pkg/rust';

const silentLogger = { error() {}, log() {}, warn() {} };

/** A staleness stub, so ensureNative tests state the verdict instead of mtimes. */
const fresh = () => ({ stale: false, reason: 'up to date' });
const stale = () => ({ stale: true, reason: 'rust/core/src/lib.rs is newer than the addon' });

describe('checkStaleness', () => {
    it('is fresh when the binary is newer than every source', () => {
        const result = checkStaleness(BINARY, RUST, {
            exists: () => true,
            mtimeOf: (p: string) => (p === BINARY ? 500 : 100),
            listSources: () => [`${RUST}/core/src/lib.rs`, `${RUST}/Cargo.toml`],
        });

        expect(result.stale).toBe(false);
    });

    it('is stale when the binary is missing', () => {
        const result = checkStaleness(BINARY, RUST, {
            exists: () => false,
            mtimeOf: () => 0,
            listSources: () => [],
        });

        expect(result.stale).toBe(true);
        expect(result.reason).toContain('is not built');
    });

    it('is stale when a Rust source is newer than the binary', () => {
        const result = checkStaleness(BINARY, RUST, {
            exists: () => true,
            mtimeOf: (p: string) => (p === `${RUST}/core/src/lib.rs` ? 900 : 500),
            listSources: () => [`${RUST}/core/src/lib.rs`],
        });

        expect(result.stale).toBe(true);
        expect(result.reason).toContain('lib.rs');
    });

    // The manifests are what a dependency bump touches; a `.rs`-only check
    // would sail past a changed Cargo.lock.
    it.each(['Cargo.toml', 'Cargo.lock'])('is stale when %s is newer than the binary', (manifest) => {
        const result = checkStaleness(BINARY, RUST, {
            exists: () => true,
            mtimeOf: (p: string) => (p.endsWith(manifest) ? 900 : 500),
            listSources: () => [`${RUST}/${manifest}`],
        });

        expect(result.stale).toBe(true);
    });

    it('ignores a source that disappears mid-walk', () => {
        const result = checkStaleness(BINARY, RUST, {
            exists: () => true,
            mtimeOf: (p: string) => {
                if (p === `${RUST}/gone.rs`) throw new Error('ENOENT');
                return p === BINARY ? 500 : 100;
            },
            listSources: () => [`${RUST}/gone.rs`, `${RUST}/Cargo.toml`],
        });

        expect(result.stale).toBe(false);
    });
});

describe('listRustSources', () => {
    const entry = (name: string, dir = false) => ({ name, isDirectory: () => dir });

    // cargo writes `target/` during the very build this gates, so counting it
    // would leave the tree permanently stale and rebuild on every restart.
    it('skips target/ and other build output', () => {
        const tree: Record<string, Array<{ name: string; isDirectory: () => boolean }>> = {
            [RUST]: [entry('Cargo.toml'), entry('core', true), entry('target', true)],
            [path.join(RUST, 'core')]: [entry('lib.rs')],
            [path.join(RUST, 'target')]: [entry('libcoc.rlib')],
        };

        const found = listRustSources(RUST, { readdir: (d: string) => tree[d] ?? [] });

        expect(found.sort()).toEqual([path.join(RUST, 'Cargo.toml'), path.join(RUST, 'core', 'lib.rs')]);
    });

    it('returns nothing when the tree is unreadable', () => {
        const found = listRustSources(RUST, {
            readdir: () => {
                throw new Error('ENOENT');
            },
        });

        expect(found).toEqual([]);
    });
});

describe('resolveCargo', () => {
    it('prefers cargo on PATH', () => {
        const found = resolveCargo({
            env: { PATH: ['/empty', '/usr/local/bin'].join(path.delimiter) },
            exists: (p: string) => p === path.join('/usr/local/bin', 'cargo'),
            platform: 'linux',
            homedir: () => '/home/me',
        });

        expect(found).toBe(path.join('/usr/local/bin', 'cargo'));
    });

    // The systemd daemon runs with a pinned PATH that omits ~/.cargo/bin.
    it('falls back to ~/.cargo/bin when PATH has no cargo', () => {
        const found = resolveCargo({
            env: { PATH: '/empty' },
            exists: (p: string) => p === path.join('/home/me', '.cargo', 'bin', 'cargo'),
            platform: 'linux',
            homedir: () => '/home/me',
        });

        expect(found).toBe(path.join('/home/me', '.cargo', 'bin', 'cargo'));
    });

    it('honours CARGO_HOME when rediscovering an installed toolchain', () => {
        const found = resolveCargo({
            env: { PATH: '/empty', CARGO_HOME: '/opt/cargo' },
            exists: (p: string) => p === path.join('/opt/cargo', 'bin', 'cargo'),
            platform: 'linux',
            homedir: () => '/home/me',
        });

        expect(found).toBe(path.join('/opt/cargo', 'bin', 'cargo'));
    });

    it('returns null when cargo is nowhere', () => {
        expect(
            resolveCargo({
                env: { PATH: '/empty' },
                exists: () => false,
                platform: 'linux',
                homedir: () => '/home/me',
            }),
        ).toBeNull();
    });

    it('looks for cargo.exe on Windows', () => {
        const found = resolveCargo({
            env: { PATH: 'C:\\tools' },
            exists: (p: string) => p.endsWith('cargo.exe'),
            platform: 'win32',
            homedir: () => 'C:\\Users\\me',
        });

        expect(found).toContain('cargo.exe');
    });
});

describe('installRust', () => {
    it.each([
        ['win32', 'x64', 'x86_64-pc-windows-msvc', 'rustup-init.exe'],
        ['linux', 'x64', 'x86_64-unknown-linux-gnu', 'rustup-init'],
        ['linux', 'arm64', 'aarch64-unknown-linux-gnu', 'rustup-init'],
        ['darwin', 'arm64', 'aarch64-apple-darwin', 'rustup-init'],
    ])('downloads and runs rustup for %s-%s', (platform, arch, target, executable) => {
        const calls: Array<{ command: string; args: string[] }> = [];
        const removed: string[] = [];
        const chmods: Array<{ file: string; mode: number }> = [];
        const status = installRust({
            platform,
            arch,
            tmpdir: '/tmp',
            mkdtemp: () => '/tmp/coc-rustup-test',
            chmod: (file: string, mode: number) => chmods.push({ file, mode }),
            remove: (dir: string) => removed.push(dir),
            readFile: () => `${'a'.repeat(64)}  ${executable}`,
            sha256: () => 'a'.repeat(64),
            run: (command: string, args: string[]) => {
                calls.push({ command, args });
                return 0;
            },
            logger: silentLogger,
        });

        expect(status).toBe(0);
        expect(rustupTarget(platform, arch)).toBe(target);
        expect(calls[0].command).toBe('curl');
        expect(calls[0].args.at(-1)).toBe(
            `https://static.rust-lang.org/rustup/dist/${target}/${executable}`,
        );
        expect(calls[1].args.at(-1)).toBe(
            `https://static.rust-lang.org/rustup/dist/${target}/${executable}.sha256`,
        );
        expect(path.basename(calls[2].command)).toBe(executable);
        expect(calls[2].args).toEqual(['-y', '--profile', 'minimal', '--no-modify-path']);
        expect(chmods).toHaveLength(platform === 'win32' ? 0 : 1);
        expect(removed).toEqual(['/tmp/coc-rustup-test']);
    });

    it('returns the download failure and still removes the temporary directory', () => {
        const removed: string[] = [];
        const status = installRust({
            platform: 'linux',
            arch: 'x64',
            tmpdir: '/tmp',
            mkdtemp: () => '/tmp/coc-rustup-test',
            remove: (dir: string) => removed.push(dir),
            run: () => 22,
            logger: silentLogger,
        });

        expect(status).toBe(22);
        expect(removed).toEqual(['/tmp/coc-rustup-test']);
    });

    it('refuses to execute an installer whose checksum does not match', () => {
        const calls: string[] = [];
        const status = installRust({
            platform: 'linux',
            arch: 'x64',
            tmpdir: '/tmp',
            mkdtemp: () => '/tmp/coc-rustup-test',
            remove: () => {},
            readFile: () => 'a'.repeat(64),
            sha256: () => 'b'.repeat(64),
            run: (command: string) => {
                calls.push(command);
                return 0;
            },
            logger: silentLogger,
        });

        expect(status).toBe(1);
        expect(calls).toEqual(['curl', 'curl']);
    });

    it('does not turn a successful install into a failure when cleanup is blocked', () => {
        const status = installRust({
            platform: 'linux',
            arch: 'x64',
            tmpdir: '/tmp',
            mkdtemp: () => '/tmp/coc-rustup-test',
            chmod: () => {},
            remove: () => {
                throw new Error('EBUSY');
            },
            readFile: () => 'a'.repeat(64),
            sha256: () => 'a'.repeat(64),
            run: () => 0,
            logger: silentLogger,
        });

        expect(status).toBe(0);
    });

    it('rejects an unsupported target without downloading anything', () => {
        let runs = 0;
        const status = installRust({
            platform: 'freebsd',
            arch: 'x64',
            run: () => {
                runs += 1;
                return 0;
            },
            logger: silentLogger,
        });

        expect(status).toBe(1);
        expect(runs).toBe(0);
    });
});

describe('ensureNative', () => {
    /** Collects the calls that matter: did we build, and what did we say? */
    function harness(overrides: Record<string, unknown> = {}) {
        const builds: string[] = [];
        const warnings: string[] = [];
        const errors: string[] = [];
        return {
            builds,
            warnings,
            errors,
            options: {
                binaryPath: BINARY,
                rustDir: RUST,
                exists: () => true,
                checkStale: stale,
                findCargo: () => '/usr/local/bin/cargo',
                installRust: () => 0,
                runBuild: (cargo: string) => {
                    builds.push(cargo);
                    return 0;
                },
                logger: {
                    ...silentLogger,
                    warn: (m: string) => warnings.push(m),
                    error: (m: string) => errors.push(m),
                },
                ...overrides,
            },
        };
    }

    // The hot path: this runs on every single daemon restart.
    it('does nothing when the addon is fresh', () => {
        const h = harness({ checkStale: fresh });

        expect(ensureNative(h.options)).toBe(0);
        expect(h.builds).toEqual([]);
    });

    it('does not even look for cargo when the addon is fresh', () => {
        let cargoLookups = 0;
        const h = harness({
            checkStale: fresh,
            findCargo: () => {
                cargoLookups += 1;
                return '/usr/local/bin/cargo';
            },
        });

        expect(ensureNative(h.options)).toBe(0);
        expect(cargoLookups).toBe(0);
    });

    it('builds when the binary is missing', () => {
        const h = harness({ exists: () => false });

        expect(ensureNative(h.options)).toBe(0);
        expect(h.builds).toEqual(['/usr/local/bin/cargo']);
    });

    it('builds when a source is newer than the binary', () => {
        const h = harness();

        expect(ensureNative(h.options)).toBe(0);
        expect(h.builds).toEqual(['/usr/local/bin/cargo']);
    });

    // A daemon serving a slightly stale addon beats a daemon that is down.
    it('keeps serving the old addon when the build fails', () => {
        const h = harness({ runBuild: () => 101 });

        expect(ensureNative(h.options)).toBe(0);
        expect(h.warnings.join('\n')).toMatch(/failed to build/);
    });

    // Nothing to fall back on — the server would die on first native use.
    it('fails when the build fails and no binary exists', () => {
        const h = harness({ exists: () => false, runBuild: () => 101 });

        expect(ensureNative(h.options)).toBe(1);
        expect(h.errors.join('\n')).toMatch(/failed to build/);
    });

    it('installs Rust, rediscovers cargo and builds', () => {
        let lookups = 0;
        let installs = 0;
        const h = harness({
            findCargo: () => (++lookups === 1 ? null : '/home/me/.cargo/bin/cargo'),
            installRust: () => {
                installs += 1;
                return 0;
            },
        });

        expect(ensureNative(h.options)).toBe(0);
        expect(installs).toBe(1);
        expect(h.builds).toEqual(['/home/me/.cargo/bin/cargo']);
    });

    it('warns but succeeds when automatic installation fails and a binary exists', () => {
        const h = harness({ findCargo: () => null, installRust: () => 1 });

        expect(ensureNative(h.options)).toBe(0);
        expect(h.builds).toEqual([]);
        expect(h.warnings.join('\n')).toMatch(/Automatic Rust installation/);
    });

    it('keeps an existing binary when the installer throws', () => {
        const h = harness({
            findCargo: () => null,
            installRust: () => {
                throw new Error('EACCES');
            },
        });

        expect(ensureNative(h.options)).toBe(0);
        expect(h.builds).toEqual([]);
        expect(h.errors.join('\n')).toMatch(/EACCES/);
    });

    it('fails when automatic installation fails and no binary exists', () => {
        const h = harness({ exists: () => false, findCargo: () => null, installRust: () => 1 });

        expect(ensureNative(h.options)).toBe(1);
        expect(h.builds).toEqual([]);
        expect(h.errors.join('\n')).toMatch(/rustup\.rs/);
    });

    it('respects the automatic installation opt-out', () => {
        let installs = 0;
        const h = harness({
            exists: () => false,
            findCargo: () => null,
            autoInstallRust: false,
            installRust: () => {
                installs += 1;
                return 0;
            },
        });

        expect(ensureNative(h.options)).toBe(1);
        expect(installs).toBe(0);
        expect(h.errors.join('\n')).toMatch(/COC_NATIVE_AUTO_INSTALL_RUST=0/);
    });
});
