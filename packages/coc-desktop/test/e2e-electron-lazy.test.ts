/**
 * Regression guard for the Electron E2E suites' skip contract.
 *
 * Both `test/e2e/*.e2e.test.ts` files are gated by `describe.skipIf(skip)` so a
 * flaky or half-installed Electron binary never wedges the desktop unit-test
 * job — on CI without `COC_DESKTOP_E2E=1` they must simply skip. That contract
 * is defeated if `require('electron')` runs at module *import* time, because a
 * concurrent-extraction race (observed on Windows as `os error 183`
 * ERROR_ALREADY_EXISTS) makes `require('electron')` throw before the skip guard
 * is ever evaluated, failing the whole file at import.
 *
 * These source-level checks pin the fix: Electron is resolved lazily inside a
 * helper that only runs within the (skippable) describe block, never at the
 * top level.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eFiles = ['find-bar.e2e.test.ts', 'popout-bar.e2e.test.ts'];

describe('E2E suites resolve Electron lazily (skip-guard robustness)', () => {
    for (const file of e2eFiles) {
        describe(file, () => {
            const source = fs.readFileSync(path.join(here, 'e2e', file), 'utf-8');

            it('does not resolve the Electron binary at module import time', () => {
                // A top-level `const electronPath = createRequire(...)('electron')`
                // executes on import, before the skip guard — the exact regression.
                expect(source).not.toMatch(/^\s*const\s+electronPath\s*=\s*createRequire/m);
            });

            it('defers Electron resolution behind a resolveElectronPath() helper', () => {
                expect(source).toContain('function resolveElectronPath()');
                expect(source).toContain('spawn(resolveElectronPath()');
            });

            it("only requires 'electron' from inside the lazy helper", () => {
                // The single createRequire('electron') call must live in the helper
                // body, i.e. after the guard variables — not at module top level.
                const requireIdx = source.indexOf("createRequire(import.meta.url)('electron')");
                const helperIdx = source.indexOf('function resolveElectronPath()');
                expect(requireIdx).toBeGreaterThan(-1);
                expect(helperIdx).toBeGreaterThan(-1);
                expect(requireIdx).toBeGreaterThan(helperIdx);
            });
        });
    }
});
