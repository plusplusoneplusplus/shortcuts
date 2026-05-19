/**
 * @vitest-environment jsdom
 *
 * Tests for SPA client runtime config loading (loadRuntimeConfig).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('loadRuntimeConfig', () => {
    let loadRuntimeConfig: () => Promise<void>;
    let isRalphEnabled: () => boolean;
    let isContainerMode: () => boolean;
    let _resetRuntimeConfig: () => void;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../../../src/server/spa/client/react/utils/config');
        loadRuntimeConfig = mod.loadRuntimeConfig;
        isRalphEnabled = mod.isRalphEnabled;
        isContainerMode = mod.isContainerMode;
        _resetRuntimeConfig = mod._resetRuntimeConfig;
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    afterEach(() => {
        _resetRuntimeConfig();
        delete (window as any).__DASHBOARD_CONFIG__;
        vi.restoreAllMocks();
    });

    it('updates feature flags from API response', async () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', ralphEnabled: false };
        expect(isRalphEnabled()).toBe(false);

        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                revision: 1,
                features: {
                    terminalEnabled: true,
                    notesEnabled: true,
                    myWorkEnabled: false,
                    myLifeEnabled: false,
                    scratchpadEnabled: false,
                    scratchpadLayout: 'horizontal',
                    workflowsEnabled: false,
                    pullRequestsEnabled: false,
                    serversEnabled: false,
                    ralphEnabled: true,
                    vimNavigationEnabled: false,
                    loopsEnabled: false,
                    excalidrawEnabled: false,
                    mcpOauthEnabled: false,
                    focusedDiffEnabled: false,
                },
                hostname: 'test-host',
                bindAddress: '127.0.0.1',
            }),
        } as Response);

        await loadRuntimeConfig();
        expect(isRalphEnabled()).toBe(true);
    });

    it('falls back to bootstrap config on fetch failure', async () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', ralphEnabled: false };

        vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network error'));

        await loadRuntimeConfig();
        expect(isRalphEnabled()).toBe(false);
    });

    it('falls back to bootstrap config on non-ok response', async () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', ralphEnabled: true };

        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
            ok: false,
            status: 500,
        } as Response);

        await loadRuntimeConfig();
        expect(isRalphEnabled()).toBe(true);
    });

    it('deduplicates concurrent calls', async () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                revision: 1,
                features: {
                    terminalEnabled: true,
                    notesEnabled: true,
                    myWorkEnabled: false,
                    myLifeEnabled: false,
                    scratchpadEnabled: false,
                    scratchpadLayout: 'horizontal',
                    workflowsEnabled: false,
                    pullRequestsEnabled: false,
                    serversEnabled: false,
                    ralphEnabled: false,
                    vimNavigationEnabled: false,
                    loopsEnabled: false,
                    excalidrawEnabled: false,
                    mcpOauthEnabled: false,
                    focusedDiffEnabled: false,
                },
            }),
        } as Response);

        await Promise.all([loadRuntimeConfig(), loadRuntimeConfig()]);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('preserves bootstrap-only fields like containerMode', async () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            containerMode: true,
        };

        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                revision: 1,
                features: {
                    terminalEnabled: true,
                    notesEnabled: true,
                    myWorkEnabled: false,
                    myLifeEnabled: false,
                    scratchpadEnabled: false,
                    scratchpadLayout: 'horizontal',
                    workflowsEnabled: false,
                    pullRequestsEnabled: false,
                    serversEnabled: false,
                    ralphEnabled: false,
                    vimNavigationEnabled: false,
                    loopsEnabled: false,
                    excalidrawEnabled: false,
                    mcpOauthEnabled: false,
                    focusedDiffEnabled: false,
                },
            }),
        } as Response);

        await loadRuntimeConfig();
        expect(isContainerMode()).toBe(true);
    });
});
