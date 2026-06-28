/**
 * Unit coverage for the native-ABI preflight that keeps `dev:desktop`
 * self-healing.
 *
 * Two concerns are pinned here:
 *   1. The pure decision helpers in `scripts/native-abi.mjs` (probe→rebuild
 *      logic, path resolution, electron-rebuild arg shape, probe script).
 *   2. The script wiring contract: `predev:desktop` runs the probe before every
 *      `dev:desktop`, and `rebuild:native` forces a rebuild via the same script
 *      (regression guard for the old broken `--module-dir ../coc` invocation).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
// The helpers ship as a runnable .mjs (consumed by Node at dev time); vitest
// imports it directly so the same code under test is the code that ships.
import {
    NATIVE_MODULES,
    workspaceRootFrom,
    moduleDir,
    resolveElectronVersion,
    shouldRebuild,
    buildRebuildArgs,
    buildProbeScript,
} from '../scripts/native-abi.mjs';

function readJson(relFromTest: string): Record<string, unknown> {
    const file = path.resolve(__dirname, relFromTest);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function scripts(pkg: Record<string, unknown>): Record<string, string> {
    return (pkg.scripts ?? {}) as Record<string, string>;
}

describe('native-abi helpers', () => {
    it('targets the two hoisted native addons', () => {
        expect(NATIVE_MODULES).toEqual(['better-sqlite3', 'node-pty']);
    });

    it('resolves the workspace root three levels above scripts/', () => {
        const scriptsDir = path.join('/repo', 'packages', 'coc-desktop', 'scripts');
        expect(workspaceRootFrom(scriptsDir)).toBe(path.resolve('/repo'));
    });

    it('resolves a hoisted module dir under the root node_modules', () => {
        expect(moduleDir('/repo', 'better-sqlite3')).toBe(
            path.join('/repo', 'node_modules', 'better-sqlite3'),
        );
    });

    it('reads the electron version from its package.json', () => {
        expect(resolveElectronVersion({ version: '35.7.5' })).toBe('35.7.5');
    });

    it('throws when the electron version is missing or empty', () => {
        expect(() => resolveElectronVersion({})).toThrow(/Electron version/);
        expect(() => resolveElectronVersion({ version: '' })).toThrow(/Electron version/);
        expect(() => resolveElectronVersion(undefined)).toThrow(/Electron version/);
    });

    describe('shouldRebuild', () => {
        it('rebuilds only when the probe fails', () => {
            expect(shouldRebuild({ probeOk: true, force: false })).toBe(false);
            expect(shouldRebuild({ probeOk: false, force: false })).toBe(true);
        });

        it('always rebuilds when forced, regardless of the probe', () => {
            expect(shouldRebuild({ probeOk: true, force: true })).toBe(true);
            expect(shouldRebuild({ probeOk: false, force: true })).toBe(true);
        });
    });

    it('builds electron-rebuild args that pin version, force, and scope to one module', () => {
        const args = buildRebuildArgs({
            version: '35.7.5',
            moduleName: 'better-sqlite3',
            moduleDirPath: '/repo/node_modules/better-sqlite3',
        });
        expect(args).toEqual([
            '--version',
            '35.7.5',
            '--force',
            '--only',
            'better-sqlite3',
            '--module-dir',
            '/repo/node_modules/better-sqlite3',
        ]);
    });

    it('builds a probe script that requires each module by JSON-escaped path', () => {
        const script = buildProbeScript([
            'C:\\repo\\node_modules\\better-sqlite3',
            '/repo/node_modules/node-pty',
        ]);
        // Backslashes must stay escaped so the one-liner is valid on Windows.
        expect(script).toBe(
            'require("C:\\\\repo\\\\node_modules\\\\better-sqlite3");require("/repo/node_modules/node-pty");',
        );
    });

    it('builds an empty probe script for no modules', () => {
        expect(buildProbeScript([])).toBe('');
    });
});

describe('native-abi script wiring', () => {
    it('exposes a package-local ensure:native that runs the preflight script', () => {
        const desktop = scripts(readJson('../package.json'));
        expect(desktop['ensure:native']).toBe('node scripts/ensure-native-abi.mjs');
    });

    it('forces a rebuild via the same script for rebuild:native (not the old broken module-dir)', () => {
        const desktop = scripts(readJson('../package.json'));
        expect(desktop['rebuild:native']).toBe('node scripts/ensure-native-abi.mjs --force');
        // Regression: the old script pointed at a non-existent `../coc` project
        // and passed no electron version, so it rebuilt nothing.
        expect(desktop['rebuild:native']).not.toMatch(/--module-dir\s+\.\.\/coc/);
    });

    it('runs the probe automatically before dev:desktop via predev:desktop', () => {
        const root = scripts(readJson('../../../package.json'));
        expect(root['predev:desktop']).toBe('npm run ensure:native -w packages/coc-desktop');
    });
});
