/**
 * @vitest-environment jsdom
 *
 * Tests for isScratchpadEnabled() in config.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('isScratchpadEnabled', () => {
    let isScratchpadEnabled: () => boolean;

    beforeEach(async () => {
        // Fresh import each time to avoid module cache
        const mod = await import('../../../../src/server/spa/client/react/utils/config');
        isScratchpadEnabled = mod.isScratchpadEnabled;
    });

    afterEach(() => {
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    it('returns false when __DASHBOARD_CONFIG__ is absent', () => {
        delete (window as any).__DASHBOARD_CONFIG__;
        expect(isScratchpadEnabled()).toBe(false);
    });

    it('returns false when scratchpadEnabled is not set', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
        expect(isScratchpadEnabled()).toBe(false);
    });

    it('returns false when scratchpadEnabled is false', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', scratchpadEnabled: false };
        expect(isScratchpadEnabled()).toBe(false);
    });

    it('returns true when scratchpadEnabled is true', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', scratchpadEnabled: true };
        expect(isScratchpadEnabled()).toBe(true);
    });
});
