/**
 * Tests for isTerminalEnabled() config utility and
 * terminalEnabled injection in generateDashboardHtml.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateDashboardHtml } from '../../server/spa-test-helpers';

// ── isTerminalEnabled ───────────────────────────────────────────────────────

describe('isTerminalEnabled', () => {
    let originalConfig: any;

    beforeEach(() => {
        originalConfig = (globalThis as any).__DASHBOARD_CONFIG__;
    });

    afterEach(() => {
        if (originalConfig !== undefined) {
            (globalThis as any).__DASHBOARD_CONFIG__ = originalConfig;
        } else {
            delete (globalThis as any).__DASHBOARD_CONFIG__;
        }
    });

    it('returns true when config has terminalEnabled: true', async () => {
        (globalThis as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', terminalEnabled: true };
        // Dynamic import to pick up the global
        const { isTerminalEnabled } = await import('../../../src/server/spa/client/react/utils/config');
        expect(isTerminalEnabled()).toBe(true);
    });

    it('returns false when config has terminalEnabled: false', async () => {
        (globalThis as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', terminalEnabled: false };
        const { isTerminalEnabled } = await import('../../../src/server/spa/client/react/utils/config');
        expect(isTerminalEnabled()).toBe(false);
    });

    it('returns false when terminalEnabled is missing', async () => {
        (globalThis as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
        const { isTerminalEnabled } = await import('../../../src/server/spa/client/react/utils/config');
        expect(isTerminalEnabled()).toBe(false);
    });
});

// ── generateDashboardHtml — terminalEnabled injection ───────────────────────

describe('generateDashboardHtml terminalEnabled', () => {
    it('injects terminalEnabled: true when option is true', () => {
        const html = generateDashboardHtml({ terminalEnabled: true });
        expect(html).toContain('terminalEnabled: true');
    });

    it('injects terminalEnabled: false when option is false', () => {
        const html = generateDashboardHtml({ terminalEnabled: false });
        expect(html).toContain('terminalEnabled: false');
    });

    it('injects terminalEnabled: false when option is omitted', () => {
        const html = generateDashboardHtml({});
        expect(html).toContain('terminalEnabled: false');
    });

    it('terminalEnabled is a boolean literal, not a quoted string', () => {
        const html = generateDashboardHtml({ terminalEnabled: true });
        // Should be `terminalEnabled: true` not `terminalEnabled: 'true'`
        expect(html).not.toMatch(/terminalEnabled:\s*['"]true['"]/);
    });
});
