/**
 * @vitest-environment jsdom
 *
 * Tests for isWorkflowsEnabled() in config.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('isWorkflowsEnabled', () => {
    let isWorkflowsEnabled: () => boolean;

    beforeEach(async () => {
        // Fresh import each time to avoid module cache
        const mod = await import('../../../../src/server/spa/client/react/utils/config');
        isWorkflowsEnabled = mod.isWorkflowsEnabled;
    });

    afterEach(() => {
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    it('returns false when __DASHBOARD_CONFIG__ is absent', () => {
        delete (window as any).__DASHBOARD_CONFIG__;
        expect(isWorkflowsEnabled()).toBe(false);
    });

    it('returns false when workflowsEnabled is not set', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
        expect(isWorkflowsEnabled()).toBe(false);
    });

    it('returns false when workflowsEnabled is false', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', workflowsEnabled: false };
        expect(isWorkflowsEnabled()).toBe(false);
    });

    it('returns true when workflowsEnabled is true', () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', workflowsEnabled: true };
        expect(isWorkflowsEnabled()).toBe(true);
    });
});
