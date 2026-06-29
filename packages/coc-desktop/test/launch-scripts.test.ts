/**
 * Regression guard for the desktop launch wiring.
 *
 * The root `dev:desktop` script used to call a bare `electron …`, which fails
 * with `sh: electron: command not found` because Electron is a devDependency of
 * *this* package — its binary lives in `packages/coc-desktop/node_modules/.bin`,
 * not on the repo-root PATH. Launching must go through a package-local script so
 * npm puts that `.bin` on PATH. These tests pin that contract.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function readJson(relFromTest: string): Record<string, unknown> {
    const file = path.resolve(__dirname, relFromTest);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function scripts(pkg: Record<string, unknown>): Record<string, string> {
    return (pkg.scripts ?? {}) as Record<string, string>;
}

describe('desktop launch scripts', () => {
    it('exposes a package-local start script that launches the built main via electron', () => {
        const pkg = readJson('../package.json');
        const desktop = scripts(pkg);
        expect(desktop.start).toBeDefined();
        // Must invoke electron (resolved from this package's local .bin)…
        expect(desktop.start).toMatch(/\belectron\b/);
        // …pointed at the package dir so Electron reads name/version/main from
        // package.json (this brands the dev app instead of showing "Electron").
        expect(desktop.start).toMatch(/electron\s+\.\s*$/);
        // The package's main entry is the compiled JS, never a source .ts file.
        expect(pkg.main).toBe('dist/main.js');
        expect(desktop.start).not.toMatch(/\.ts\b/);
    });

    it('brands the app via productName so Electron does not show "Electron" in dev', () => {
        const pkg = readJson('../package.json');
        expect(pkg.productName).toBe('CoC');
    });

    it('roots dev:desktop through the workspace start script, never a bare electron', () => {
        const root = scripts(readJson('../../../package.json'));
        expect(root['dev:desktop']).toBeDefined();
        // It rebuilds the coc server first — the desktop app forks the *built*
        // `@plusplusoneplusplus/coc/dist/server`, so without this the launched
        // background server would run stale code. The `(?:\s|&)` guard makes sure
        // this matches `packages/coc` exactly and not `packages/coc-desktop`.
        expect(root['dev:desktop']).toMatch(/npm run build -w packages\/coc(?:\s|&|$)/);
        // …and builds this package too.
        expect(root['dev:desktop']).toContain('npm run build -w packages/coc-desktop');
        // …then launches via the workspace-scoped start (so electron is on PATH).
        expect(root['dev:desktop']).toContain('npm run start -w packages/coc-desktop');
        // Regression: must NOT shell out to a bare `electron <path>` from root,
        // where the binary is not on PATH.
        expect(root['dev:desktop']).not.toMatch(/&&\s*electron\s/);
    });
});
