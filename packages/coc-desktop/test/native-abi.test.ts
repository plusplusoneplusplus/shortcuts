/**
 * Unit coverage for the native-ABI preflight that keeps `dev:desktop`
 * self-healing.
 *
 * Two concerns are pinned here:
 *   1. The pure decision helpers in `scripts/native-abi.mjs` (probe script
 *      shape, probe-output parsing, path resolution, cache keying,
 *      electron-rebuild arg shape).
 *   2. The script wiring contract: `prestart` runs the probe before EVERY
 *      desktop launch (root `dev:desktop` and direct `npm start` alike), and
 *      `rebuild:native` forces a rebuild via the same script (regression guard
 *      for the old broken `--module-dir ../coc` invocation).
 *
 * The probe-script tests below are the regression guard for the lazy-load bug:
 * better-sqlite3 only dlopens its addon inside `new Database()`, so a probe
 * that merely require()s the package always passed and the preflight silently
 * skipped the rebuild — the desktop then died at runtime with
 * NODE_MODULE_VERSION mismatch. The probe must construct a Database.
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
    bindingPath,
    cachedBindingPath,
    resolveElectronVersion,
    buildRebuildArgs,
    buildProbeScript,
    parseProbeOutput,
} from '../scripts/native-abi.mjs';

function readJson(relFromTest: string): Record<string, unknown> {
    const file = path.resolve(__dirname, relFromTest);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function scripts(pkg: Record<string, unknown>): Record<string, string> {
    return (pkg.scripts ?? {}) as Record<string, string>;
}

type NativeModule = {
    name: string;
    binding: string;
    exercise: (dirExpr: string) => string;
};

function moduleByName(name: string): NativeModule {
    const m = (NATIVE_MODULES as NativeModule[]).find((mod) => mod.name === name);
    if (!m) throw new Error(`module ${name} not in NATIVE_MODULES`);
    return m;
}

describe('native-abi helpers', () => {
    it('targets the two hoisted native addons with their compiled binding names', () => {
        expect((NATIVE_MODULES as NativeModule[]).map((m) => m.name)).toEqual([
            'better-sqlite3',
            'node-pty',
        ]);
        expect(moduleByName('better-sqlite3').binding).toBe('better_sqlite3.node');
        expect(moduleByName('node-pty').binding).toBe('pty.node');
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

    it('resolves a compiled binding under build/Release', () => {
        expect(bindingPath(path.join('/repo', 'node_modules', 'better-sqlite3'), 'better_sqlite3.node')).toBe(
            path.join('/repo', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
        );
    });

    it('keys the binary cache by module version, ABI, platform, and arch', () => {
        const dir = cachedBindingPath('/repo', {
            name: 'better-sqlite3',
            version: '11.10.0',
            abi: '133',
            platform: 'darwin',
            arch: 'arm64',
        });
        expect(dir).toBe(
            path.join(
                '/repo',
                'node_modules',
                '.cache',
                'coc-native-abi',
                'better-sqlite3@11.10.0',
                'abi-133-darwin-arm64',
            ),
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

    describe('buildProbeScript', () => {
        it('exercises better-sqlite3 by constructing a Database, not just requiring it', () => {
            // Regression: better-sqlite3 loads its addon lazily inside `new
            // Database()`. A bare require() dlopens nothing, so the old probe
            // passed on a stale tree and the rebuild was skipped.
            const m = moduleByName('better-sqlite3');
            const script = buildProbeScript([{ ...m, dir: '/repo/node_modules/better-sqlite3' }]);
            expect(script).toContain(`new M(':memory:').close()`);
            expect(script).toContain('require("/repo/node_modules/better-sqlite3")');
        });

        it('exercises node-pty with a bare require (its addon loads eagerly)', () => {
            const m = moduleByName('node-pty');
            const script = buildProbeScript([{ ...m, dir: '/repo/node_modules/node-pty' }]);
            expect(script).toContain('require("/repo/node_modules/node-pty");');
        });

        it('reports the runtime ABI and a per-module OK/FAIL line, exiting non-zero on any failure', () => {
            const mods = (NATIVE_MODULES as NativeModule[]).map((m) => ({
                ...m,
                dir: `/repo/node_modules/${m.name}`,
            }));
            const script = buildProbeScript(mods);
            expect(script).toContain(`console.log('ABI ' + process.versions.modules)`);
            expect(script).toContain(`console.log('OK better-sqlite3')`);
            expect(script).toContain(`console.log('OK node-pty')`);
            expect(script).toMatch(/FAIL better-sqlite3/);
            expect(script).toContain('process.exit(failed ? 1 : 0);');
        });

        it('JSON-escapes Windows paths so the one-liner stays valid', () => {
            const m = moduleByName('better-sqlite3');
            const script = buildProbeScript([{ ...m, dir: 'C:\\repo\\node_modules\\better-sqlite3' }]);
            expect(script).toContain('require("C:\\\\repo\\\\node_modules\\\\better-sqlite3")');
        });
    });

    describe('parseProbeOutput', () => {
        const names = ['better-sqlite3', 'node-pty'];

        it('parses the ABI and per-module results', () => {
            const out = 'ABI 133\nFAIL better-sqlite3 The module was compiled against NODE_MODULE_VERSION 141\nOK node-pty\n';
            const res = parseProbeOutput(out, names);
            expect(res.abi).toBe('133');
            expect(res.ok).toEqual(['node-pty']);
            expect(Object.keys(res.failed)).toEqual(['better-sqlite3']);
            expect(res.failed['better-sqlite3']).toMatch(/NODE_MODULE_VERSION 141/);
        });

        it('treats every module as passing on a clean probe', () => {
            const res = parseProbeOutput('ABI 141\nOK better-sqlite3\nOK node-pty\n', names);
            expect(res.abi).toBe('141');
            expect(res.ok).toEqual(names);
            expect(res.failed).toEqual({});
        });

        it('treats modules missing from the output as failed (probe crashed early)', () => {
            const res = parseProbeOutput('ABI 133\n', names);
            expect(res.failed['better-sqlite3']).toMatch(/no probe result/);
            expect(res.failed['node-pty']).toMatch(/no probe result/);
        });

        it('survives empty/undefined output and CRLF line endings', () => {
            expect(parseProbeOutput(undefined, names).abi).toBeNull();
            const res = parseProbeOutput('ABI 133\r\nOK better-sqlite3\r\nOK node-pty\r\n', names);
            expect(res.failed).toEqual({});
            expect(res.abi).toBe('133');
        });

        it('ignores OK/FAIL lines for modules it was not asked about', () => {
            const res = parseProbeOutput('ABI 133\nOK rogue-module\nOK better-sqlite3\nOK node-pty\n', names);
            expect(res.ok).toEqual(names);
        });
    });
});

describe('native-abi script wiring', () => {
    it('exposes a package-local ensure:native that runs the preflight script', () => {
        const desktop = scripts(readJson('../package.json'));
        expect(desktop['ensure:native']).toBe('node scripts/ensure-native-abi.mjs');
    });

    it('runs the preflight before EVERY desktop launch via prestart', () => {
        // Regression: the hook used to live only on the root `predev:desktop`,
        // so `npm run start -w packages/coc-desktop` (or npm start in the
        // package) bypassed the probe entirely and hit the ABI crash at runtime.
        const desktop = scripts(readJson('../package.json'));
        expect(desktop.prestart).toBe('node scripts/ensure-native-abi.mjs');
    });

    it('forces a rebuild via the same script for rebuild:native (not the old broken module-dir)', () => {
        const desktop = scripts(readJson('../package.json'));
        expect(desktop['rebuild:native']).toBe('node scripts/ensure-native-abi.mjs --force');
        // Regression: the old script pointed at a non-existent `../coc` project
        // and passed no electron version, so it rebuilt nothing.
        expect(desktop['rebuild:native']).not.toMatch(/--module-dir\s+\.\.\/coc/);
    });

    it('offers the plain-Node flavor flip for the local server, package-local and at root', () => {
        const desktop = scripts(readJson('../package.json'));
        expect(desktop['ensure:native:node']).toBe('node scripts/ensure-native-abi.mjs --runtime=node');
        const root = scripts(readJson('../../../package.json'));
        expect(root['ensure:native:node']).toBe('npm run ensure:native:node -w packages/coc-desktop');
    });

    it('reaches the preflight from root dev:desktop through the workspace start script', () => {
        // dev:desktop ends in `npm run start -w packages/coc-desktop`, whose
        // prestart hook runs the probe — no separate root predev hook needed.
        const root = scripts(readJson('../../../package.json'));
        expect(root['dev:desktop']).toContain('npm run start -w packages/coc-desktop');
        expect(root['predev:desktop']).toBeUndefined();
    });
});
