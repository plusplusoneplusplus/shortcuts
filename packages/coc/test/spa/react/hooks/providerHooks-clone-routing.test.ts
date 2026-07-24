/**
 * @vitest-environment jsdom
 *
 * AC-07 (subtask 8b) — the provider/model/effort composer hooks route to the
 * OWNING clone's server when a remote baseUrl is threaded in, and never fall
 * through to the local origin client. Also proves the server-scoped
 * staticConfigCache keeps two servers that share a provider id from sharing
 * cache entries (AC-07 DoD #4).
 *
 * The composer wiring (InitialChatComposer) passes `useResolveCloneBaseUrl()(workspaceId)`
 * into each of these hooks; this file exercises the hooks directly at that seam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ── Fake clients: one LOCAL, plus a per-baseUrl REMOTE registry ────────────────

function makeFakeClient() {
    return {
        agentProviders: {
            list: vi.fn().mockResolvedValue({ providers: [{ id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true }] }),
            listModels: vi.fn().mockResolvedValue({ provider: 'copilot', models: [{ id: 'gpt-4', enabled: true }] }),
            getReasoningEfforts: vi.fn().mockResolvedValue({ reasoningEfforts: {} }),
            getEffortTiers: vi.fn().mockResolvedValue({ provider: 'copilot', effortTiers: {}, defaults: {} }),
            replaceEffortTiers: vi.fn().mockResolvedValue({ provider: 'copilot', effortTiers: {}, defaults: {} }),
        },
        preferences: {
            getRepo: vi.fn().mockResolvedValue({}),
        },
    };
}

const local = vi.hoisted(() => ({ client: null as any }));
const remotes = vi.hoisted(() => ({ map: new Map<string, any>() }));
const getCocClientForSpy = vi.hoisted(() => ({ fn: null as any }));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => local.client,
    getCocClientFor: (baseUrl?: string) => getCocClientForSpy.fn(baseUrl),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) =>
        err instanceof Error ? err.message : fallback,
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getActiveProvider: () => 'copilot',
}));

import { useModels } from '../../../../src/server/spa/client/react/hooks/useModels';
import { useProviderReasoningEfforts } from '../../../../src/server/spa/client/react/hooks/useProviderReasoningEfforts';
import { useProviderEffortTiers } from '../../../../src/server/spa/client/react/hooks/useProviderEffortTiers';
import { useAgentProviders } from '../../../../src/server/spa/client/react/hooks/useAgentProviders';
import { useDefaultModelForMode } from '../../../../src/server/spa/client/react/hooks/useDefaultModelForMode';
import { _clearConfigCache } from '../../../../src/server/spa/client/react/api/staticConfigCache';

const REMOTE_A = 'http://remote-a:4000';
const REMOTE_B = 'http://remote-b:5000';

function remoteFor(baseUrl: string) {
    let c = remotes.map.get(baseUrl);
    if (!c) { c = makeFakeClient(); remotes.map.set(baseUrl, c); }
    return c;
}

beforeEach(() => {
    _clearConfigCache();
    local.client = makeFakeClient();
    remotes.map.clear();
    // getCocClientFor should only ever be invoked with a truthy baseUrl (the
    // hooks call getSpaCocClient() directly for the local case).
    getCocClientForSpy.fn = vi.fn((baseUrl?: string) => {
        if (!baseUrl) throw new Error('getCocClientFor called without a baseUrl');
        return remoteFor(baseUrl);
    });
});

afterEach(() => { vi.clearAllMocks(); });

describe('provider/model/effort hooks route to the owning clone (AC-07 8b)', () => {
    it('useModels reads the REMOTE client and never the local one', async () => {
        renderHook(() => useModels('copilot', REMOTE_A));
        await waitFor(() => expect(remoteFor(REMOTE_A).agentProviders.listModels).toHaveBeenCalledWith('copilot'));
        expect(local.client.agentProviders.listModels).not.toHaveBeenCalled();
    });

    it('useProviderReasoningEfforts reads the REMOTE client', async () => {
        renderHook(() => useProviderReasoningEfforts('copilot' as any, REMOTE_A));
        await waitFor(() => expect(remoteFor(REMOTE_A).agentProviders.getReasoningEfforts).toHaveBeenCalledWith('copilot'));
        expect(local.client.agentProviders.getReasoningEfforts).not.toHaveBeenCalled();
    });

    it('useProviderEffortTiers reads the REMOTE client', async () => {
        renderHook(() => useProviderEffortTiers('copilot' as any, REMOTE_A));
        await waitFor(() => expect(remoteFor(REMOTE_A).agentProviders.getEffortTiers).toHaveBeenCalledWith('copilot'));
        expect(local.client.agentProviders.getEffortTiers).not.toHaveBeenCalled();
    });

    it('useAgentProviders reads the REMOTE client', async () => {
        renderHook(() => useAgentProviders(REMOTE_A));
        await waitFor(() => expect(remoteFor(REMOTE_A).agentProviders.list).toHaveBeenCalled());
        expect(local.client.agentProviders.list).not.toHaveBeenCalled();
    });

    it('useDefaultModelForMode reads per-repo preferences from the REMOTE client', async () => {
        renderHook(() => useDefaultModelForMode('ws-1', 'ask', [], 'copilot', REMOTE_A));
        await waitFor(() => expect(remoteFor(REMOTE_A).preferences.getRepo).toHaveBeenCalledWith('ws-1'));
        expect(local.client.preferences.getRepo).not.toHaveBeenCalled();
    });

    it('omitting the baseUrl keeps every hook on the LOCAL client (getCocClientFor untouched)', async () => {
        renderHook(() => useModels('copilot'));
        renderHook(() => useProviderReasoningEfforts('copilot' as any));
        renderHook(() => useProviderEffortTiers('copilot' as any));
        renderHook(() => useAgentProviders());
        renderHook(() => useDefaultModelForMode('ws-1', 'ask', [], 'copilot'));
        await waitFor(() => expect(local.client.agentProviders.listModels).toHaveBeenCalledWith('copilot'));
        await waitFor(() => expect(local.client.preferences.getRepo).toHaveBeenCalledWith('ws-1'));
        expect(getCocClientForSpy.fn).not.toHaveBeenCalled();
    });

    it('two servers sharing a provider id do NOT share config-cache entries', async () => {
        // Same provider, distinct servers → each fetches from its own server exactly once.
        renderHook(() => useModels('copilot', REMOTE_A));
        await waitFor(() => expect(remoteFor(REMOTE_A).agentProviders.listModels).toHaveBeenCalledTimes(1));

        renderHook(() => useModels('copilot', REMOTE_B));
        await waitFor(() => expect(remoteFor(REMOTE_B).agentProviders.listModels).toHaveBeenCalledTimes(1));

        // Neither server served the other's cached catalog, and neither hit local.
        expect(remoteFor(REMOTE_A).agentProviders.listModels).toHaveBeenCalledTimes(1);
        expect(remoteFor(REMOTE_B).agentProviders.listModels).toHaveBeenCalledTimes(1);
        expect(local.client.agentProviders.listModels).not.toHaveBeenCalled();
    });
});
