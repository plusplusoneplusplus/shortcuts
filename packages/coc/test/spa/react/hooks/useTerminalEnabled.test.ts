/**
 * Tests for useTerminalEnabled hook — verifies it reads from the dynamic
 * admin config (useDisplaySettings) rather than from the static HTML config
 * (window.__DASHBOARD_CONFIG__).
 *
 * Regression test: the hook previously used isTerminalEnabled() from
 * utils/config.ts which only reads window.__DASHBOARD_CONFIG__ set at
 * server start-up. Toggling terminal in Admin had no effect until restart.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOK_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'hooks', 'useTerminalEnabled.ts'
);

describe('useTerminalEnabled', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(HOOK_PATH, 'utf-8');
    });

    it('imports useDisplaySettings (dynamic config)', () => {
        expect(source).toContain("import { useDisplaySettings } from './useDisplaySettings'");
    });

    it('reads terminalEnabled from useDisplaySettings()', () => {
        expect(source).toContain('useDisplaySettings().terminalEnabled');
    });

    it('does NOT import isTerminalEnabled from static config (regression)', () => {
        expect(source).not.toContain("from '../utils/config'");
        expect(source).not.toContain('isTerminalEnabled');
    });
});
