/**
 * Unit coverage for resolving the spawnable Codex native binary path.
 *
 * Regression context: `@openai/codex-sdk` spawns the native `codex` binary
 * directly. In packaged desktop builds the SDK resolves it inside `app.asar`,
 * which `spawn` cannot execute (`ENOTDIR`). resolveCodexExecutablePath computes
 * the same path and rewrites it to the `app.asar.unpacked` copy, so the desktop
 * app can pass it as the SDK's `codexPathOverride`.
 *
 * The resolver is fully injectable (platform/arch/resolve/existsSync), so these
 * tests never touch a real install or the filesystem.
 */

import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { resolveCodexExecutablePath, CodexExecPathEnv } from '../src/codex-exec-path';

/** Packaged-app layout: the platform package lives inside app.asar. */
const ASAR_PKG_JSON =
    '/Applications/CoC.app/Contents/Resources/app.asar/node_modules/@openai/codex-darwin-arm64/package.json';
const ASAR_VENDOR =
    '/Applications/CoC.app/Contents/Resources/app.asar/node_modules/@openai/codex-darwin-arm64/vendor';
const UNPACKED_BIN = path.join(
    ASAR_VENDOR.replace('app.asar', 'app.asar.unpacked'),
    'aarch64-apple-darwin',
    'bin',
    'codex',
);

function macEnv(over: Partial<CodexExecPathEnv> = {}): CodexExecPathEnv {
    return {
        platform: 'darwin',
        arch: 'arm64',
        resolve: (req) => {
            if (req === '@openai/codex-darwin-arm64/package.json') {
                return ASAR_PKG_JSON;
            }
            throw new Error(`unexpected resolve: ${req}`);
        },
        existsSync: (p) => p === UNPACKED_BIN,
        ...over,
    };
}

describe('resolveCodexExecutablePath', () => {
    it('rewrites the app.asar binary to its unpacked copy (current layout)', () => {
        expect(resolveCodexExecutablePath(macEnv())).toBe(UNPACKED_BIN);
    });

    it('falls back to the legacy vendor/<triple>/codex layout', () => {
        const legacy = path.join(
            ASAR_VENDOR.replace('app.asar', 'app.asar.unpacked'),
            'aarch64-apple-darwin',
            'codex',
            'codex',
        );
        const exec = resolveCodexExecutablePath(macEnv({ existsSync: (p) => p === legacy }));
        expect(exec).toBe(legacy);
    });

    it('picks codex.exe and the win32-x64 package on Windows', () => {
        // Path math uses the host `path`, so feed a POSIX-style input on a POSIX
        // test host and assert the binary name + the asar→unpacked rewrite.
        let requested = '';
        const exec = resolveCodexExecutablePath({
            platform: 'win32',
            arch: 'x64',
            resolve: (req) => {
                requested = req;
                return '/root/app.asar/node_modules/@openai/codex-win32-x64/package.json';
            },
            existsSync: (p) => p.endsWith('codex.exe') && p.includes('app.asar.unpacked'),
        });
        expect(requested).toBe('@openai/codex-win32-x64/package.json');
        expect(exec).toBeDefined();
        expect(exec!.endsWith('codex.exe')).toBe(true);
        expect(exec).toContain('x86_64-pc-windows-msvc');
        expect(exec).toContain('app.asar.unpacked');
    });

    it('returns a plain (non-asar) path unchanged when the file exists (dev/global install)', () => {
        const devPkgJson =
            '/repo/node_modules/@openai/codex-darwin-arm64/package.json';
        const devBin = '/repo/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex';
        const exec = resolveCodexExecutablePath({
            platform: 'darwin',
            arch: 'arm64',
            resolve: () => devPkgJson,
            existsSync: (p) => p === devBin,
        });
        expect(exec).toBe(devBin);
    });

    it('returns undefined when no candidate binary exists', () => {
        expect(resolveCodexExecutablePath(macEnv({ existsSync: () => false }))).toBeUndefined();
    });

    it('returns undefined for an unsupported platform/arch', () => {
        const calledResolve = (): string => {
            throw new Error('resolve should not be called for an unsupported platform');
        };
        expect(
            resolveCodexExecutablePath({ platform: 'aix' as NodeJS.Platform, arch: 'ppc64', resolve: calledResolve }),
        ).toBeUndefined();
        expect(
            resolveCodexExecutablePath({ platform: 'darwin', arch: 'ia32', resolve: calledResolve }),
        ).toBeUndefined();
    });

    it('returns undefined when the platform package cannot be resolved (binaries not installed)', () => {
        const exec = resolveCodexExecutablePath({
            platform: 'darwin',
            arch: 'arm64',
            resolve: () => {
                throw new Error('Cannot find module');
            },
            existsSync: () => true,
        });
        expect(exec).toBeUndefined();
    });
});
