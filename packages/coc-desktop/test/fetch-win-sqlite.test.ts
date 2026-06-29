/**
 * Unit coverage for the Windows better-sqlite3 prebuild fetch helper.
 *
 * The bug this guards: `fetch-win-sqlite.mjs` used to spawn
 * `node_modules/.bin/prebuild-install` directly, which throws ENOENT on the
 * Windows CI runner because the `.bin` entry is an extensionless shell shim
 * that `execFileSync` can't run without a shell. The fix targets the package's
 * own `bin.js` and runs it with the current Node, so we pin:
 *   1. The resolved entrypoint is `prebuild-install/bin.js`, NOT the `.bin` shim.
 *   2. The spawn args lead with that entrypoint (i.e. run via `process.execPath`).
 *   3. The npm script wiring still runs this script for `dist:win`.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
// The helpers ship as the runnable .mjs (consumed by Node at packaging time);
// vitest imports it directly so the code under test is the code that ships.
// Importing must not trigger a download — the fetch is guarded behind "run as
// main", so a bare import only exposes the pure helpers.
import {
    electronPkgCandidates,
    resolveElectronVersion,
    prebuildInstallEntry,
    resolvePlatformArch,
    buildPrebuildArgs,
} from '../scripts/fetch-win-sqlite.mjs';

function readJson(relFromTest: string): Record<string, unknown> {
    const file = path.resolve(__dirname, relFromTest);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function scripts(pkg: Record<string, unknown>): Record<string, string> {
    return (pkg.scripts ?? {}) as Record<string, string>;
}

describe('fetch-win-sqlite helpers', () => {
    it('looks for electron package-local first, then the hoisted root', () => {
        expect(electronPkgCandidates('/repo/packages/coc-desktop', '/repo')).toEqual([
            path.join('/repo/packages/coc-desktop', 'node_modules', 'electron', 'package.json'),
            path.join('/repo', 'node_modules', 'electron', 'package.json'),
        ]);
    });

    it('reads the electron version from its package.json', () => {
        expect(resolveElectronVersion({ version: '35.7.5' })).toBe('35.7.5');
    });

    it('throws when the electron version is missing or empty', () => {
        expect(() => resolveElectronVersion({})).toThrow(/Electron version/);
        expect(() => resolveElectronVersion({ version: '' })).toThrow(/Electron version/);
        expect(() => resolveElectronVersion(undefined)).toThrow(/Electron version/);
    });

    describe('prebuildInstallEntry', () => {
        it('resolves the package bin.js under the workspace-root node_modules', () => {
            expect(prebuildInstallEntry('/repo')).toBe(
                path.join('/repo', 'node_modules', 'prebuild-install', 'bin.js'),
            );
        });

        it('never returns the .bin shim (regression: ENOENT on Windows)', () => {
            const entry = prebuildInstallEntry('/repo');
            // The extensionless `.bin/prebuild-install` shim is exactly what broke
            // the Windows build — make sure we resolve away from it.
            expect(entry).not.toContain(`${path.sep}.bin${path.sep}`);
            expect(entry.endsWith('bin.js')).toBe(true);
        });
    });

    describe('resolvePlatformArch', () => {
        it('defaults to win32-x64', () => {
            expect(resolvePlatformArch({})).toEqual({ platform: 'win32', arch: 'x64' });
            expect(resolvePlatformArch()).toEqual({ platform: 'win32', arch: 'x64' });
        });

        it('honors COC_WIN_PLATFORM / COC_WIN_ARCH overrides', () => {
            expect(
                resolvePlatformArch({ COC_WIN_PLATFORM: 'win32', COC_WIN_ARCH: 'arm64' }),
            ).toEqual({ platform: 'win32', arch: 'arm64' });
        });
    });

    describe('buildPrebuildArgs', () => {
        it('leads with the entrypoint so it runs via the current Node, then pins the ABI', () => {
            const entry = path.join('/repo', 'node_modules', 'prebuild-install', 'bin.js');
            const args = buildPrebuildArgs({
                entry,
                electronVersion: '35.7.5',
                platform: 'win32',
                arch: 'x64',
            });
            // First arg is the JS entrypoint — spawned as `node bin.js ...`, which
            // is what makes this Windows-safe (no `.bin` shim, no shell).
            expect(args[0]).toBe(entry);
            expect(args.slice(1)).toEqual([
                '-r',
                'electron',
                '-t',
                '35.7.5',
                '--platform',
                'win32',
                '--arch',
                'x64',
                '--tag-prefix',
                'v',
            ]);
        });
    });
});

describe('fetch-win-sqlite script wiring', () => {
    it('runs the fetch script for prebuild:sqlite:win', () => {
        const desktop = scripts(readJson('../package.json'));
        expect(desktop['prebuild:sqlite:win']).toBe('node scripts/fetch-win-sqlite.mjs');
    });

    it('runs the prebuild fetch before electron-builder for dist:win', () => {
        const desktop = scripts(readJson('../package.json'));
        expect(desktop['dist:win']).toContain('npm run prebuild:sqlite:win');
        expect(desktop['dist:win']).toContain('electron-builder --win');
    });
});
