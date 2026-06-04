/**
 * @vitest-environment jsdom
 *
 * Tests for isRalphEnabled() in config.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('isRalphEnabled', () => {
    let isRalphEnabled: () => boolean;
    let isForEachEnabled: () => boolean;

    beforeEach(async () => {
        // Fresh import each time to avoid module cache
        const mod = await import('../../../../src/server/spa/client/react/utils/config');
        isRalphEnabled = mod.isRalphEnabled;
        isForEachEnabled = mod.isForEachEnabled;
    });

    afterEach(() => {
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    it('returns false when __DASHBOARD_CONFIG__ is absent', () => {
        delete (window as any).__DASHBOARD_CONFIG__;
        expect(isRalphEnabled()).toBe(false);
    });

    it('returns false when ralphEnabled is not set', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
        expect(isRalphEnabled()).toBe(false);
    });

    it('returns false when ralphEnabled is false', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', ralphEnabled: false };
        expect(isRalphEnabled()).toBe(false);
    });

    it('returns true when ralphEnabled is true', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', ralphEnabled: true };
        expect(isRalphEnabled()).toBe(true);
    });

    it('returns true only when forEachEnabled is true', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', forEachEnabled: false };
        expect(isForEachEnabled()).toBe(false);

        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', forEachEnabled: true };
        expect(isForEachEnabled()).toBe(true);
    });
});
