/**
 * @vitest-environment jsdom
 *
 * Tests for SPA client runtime config loading (loadRuntimeConfig).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('loadRuntimeConfig', () => {
    let loadRuntimeConfig: () => Promise<void>;
    let isRalphEnabled: () => boolean;
    let isForEachEnabled: () => boolean;
    let isGitCrossCloneCherryPickEnabled: () => boolean;
    let isSessionContextAttachmentsEnabled: () => boolean;
    let isCommitChatLensEnabled: () => boolean;
    let isPullRequestsAutoClassifyTeamEnabled: () => boolean;
    let isContainerMode: () => boolean;
    let setCurrentAgentId: (id: string | null) => void;
    let _resetRuntimeConfig: () => void;

    beforeEach(async () => {
        vi.resetModules();
        const mod = await import('../../../../src/server/spa/client/react/utils/config');
        loadRuntimeConfig = mod.loadRuntimeConfig;
        isRalphEnabled = mod.isRalphEnabled;
        isForEachEnabled = mod.isForEachEnabled;
        isGitCrossCloneCherryPickEnabled = mod.isGitCrossCloneCherryPickEnabled;
        isSessionContextAttachmentsEnabled = mod.isSessionContextAttachmentsEnabled;
        isCommitChatLensEnabled = mod.isCommitChatLensEnabled;
        isPullRequestsAutoClassifyTeamEnabled = mod.isPullRequestsAutoClassifyTeamEnabled;
        isContainerMode = mod.isContainerMode;
        setCurrentAgentId = mod.setCurrentAgentId;
        _resetRuntimeConfig = mod._resetRuntimeConfig;
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    afterEach(() => {
        _resetRuntimeConfig();
        setCurrentAgentId(null);
        delete (window as any).__DASHBOARD_CONFIG__;
        vi.restoreAllMocks();
    });

    it('updates feature flags from API response', async () => {
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws', ralphEnabled: false };
        expect(isRalphEnabled()).toBe(false);
        expect(isForEachEnabled()).toBe(false);
        expect(isGitCrossCloneCherryPickEnabled()).toBe(false);
        expect(isSessionContextAttachmentsEnabled()).toBe(false);
        expect(isCommitChatLensEnabled()).toBe(false);
        expect(isPullRequestsAutoClassifyTeamEnabled()).toBe(false);

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
                    pullRequestsAutoClassifyTeamEnabled: true,
                    serversEnabled: false,
                    ralphEnabled: true,
                    forEachEnabled: true,
                    vimNavigationEnabled: false,
                    loopsEnabled: false,
                    excalidrawEnabled: false,
                    mcpOauthEnabled: false,
                    focusedDiffEnabled: false,
                    gitCrossCloneCherryPickEnabled: true,
                    sessionContextAttachmentsEnabled: true,
                    commitChatLensEnabled: true,
                },
                hostname: 'test-host',
                bindAddress: '127.0.0.1',
            }),
        } as Response);

        await loadRuntimeConfig();
        expect(isRalphEnabled()).toBe(true);
        expect(isForEachEnabled()).toBe(true);
        expect(isGitCrossCloneCherryPickEnabled()).toBe(true);
        expect(isSessionContextAttachmentsEnabled()).toBe(true);
        expect(isCommitChatLensEnabled()).toBe(true);
        expect(isPullRequestsAutoClassifyTeamEnabled()).toBe(true);
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
                    forEachEnabled: false,
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
                    forEachEnabled: false,
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

    it('reloads runtime config from agent when setCurrentAgentId is called in container mode', async () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            containerMode: true,
            ralphEnabled: false,
        };
        expect(isRalphEnabled()).toBe(false);

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                revision: 1,
                features: {
                    terminalEnabled: true,
                    notesEnabled: false,
                    myWorkEnabled: false,
                    myLifeEnabled: false,
                    scratchpadEnabled: false,
                    scratchpadLayout: 'horizontal',
                    workflowsEnabled: false,
                    pullRequestsEnabled: false,
                    serversEnabled: false,
                    ralphEnabled: true,
                    forEachEnabled: true,
                    vimNavigationEnabled: false,
                    loopsEnabled: true,
                    excalidrawEnabled: false,
                    mcpOauthEnabled: false,
                    focusedDiffEnabled: false,
                },
            }),
        } as Response);

        setCurrentAgentId('agent-123');
        // Wait for the async fetch to settle
        await new Promise(r => setTimeout(r, 10));

        expect(fetchSpy).toHaveBeenCalledWith('/api/agent/agent-123/config/runtime');
        expect(isRalphEnabled()).toBe(true);
        expect(isForEachEnabled()).toBe(true);
    });

    it('does not reload config when setCurrentAgentId is called outside container mode', async () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            containerMode: false,
            ralphEnabled: false,
        };

        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        setCurrentAgentId('agent-456');
        await new Promise(r => setTimeout(r, 10));

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(isRalphEnabled()).toBe(false);
    });

    it('does not reload config when same agent is set again', async () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            containerMode: true,
            ralphEnabled: false,
        };

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                revision: 1,
                features: { ralphEnabled: true },
            }),
        } as Response);

        setCurrentAgentId('agent-A');
        await new Promise(r => setTimeout(r, 10));
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        // Setting the same agent again should not trigger another fetch
        setCurrentAgentId('agent-A');
        await new Promise(r => setTimeout(r, 10));
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});
