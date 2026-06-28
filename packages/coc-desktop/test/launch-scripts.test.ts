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
        const desktop = scripts(readJson('../package.json'));
        expect(desktop.start).toBeDefined();
        // Must invoke electron (resolved from this package's local .bin)…
        expect(desktop.start).toMatch(/\belectron\b/);
        // …and point it at the compiled entry, not a source .ts file.
        expect(desktop.start).toContain('dist/main.js');
    });

    it('roots dev:desktop through the workspace start script, never a bare electron', () => {
        const root = scripts(readJson('../../../package.json'));
        expect(root['dev:desktop']).toBeDefined();
        // It still builds this package first…
        expect(root['dev:desktop']).toContain('npm run build -w packages/coc-desktop');
        // …then launches via the workspace-scoped start (so electron is on PATH).
        expect(root['dev:desktop']).toContain('npm run start -w packages/coc-desktop');
        // Regression: must NOT shell out to a bare `electron <path>` from root,
        // where the binary is not on PATH.
        expect(root['dev:desktop']).not.toMatch(/&&\s*electron\s/);
    });
});
