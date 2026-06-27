/**
 * Integration tests for AC-01 / AC-05: the provider-config hooks
 * (useModels, useModelConfig, useProviderModels, useProviderReasoningEfforts,
 * useProviderEffortTiers) read through the shared staticConfigCache.
 *
 * Verifies that:
 *  - a warm second open of an already-seen provider issues NO network call and
 *    paints without a loading flash (AC-01),
 *  - a not-yet-seen provider fetches exactly once and populates the cache,
 *  - useModels and useProviderModels share the per-provider models key, and
 *  - a settings mutation (reload / save / setReasoningEffort) invalidates the
 *    key so the next read refetches (AC-05).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    agentProviders: {
        listModels: vi.fn(),
        setEnabledModels: vi.fn(),
        getReasoningEfforts: vi.fn(),
        setReasoningEffort: vi.fn(),
        getEffortTiers: vi.fn(),
        replaceEffortTiers: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/api/cocClient')>();
    return {
        ...actual,
        getSpaCocClient: () => ({ agentProviders: mocks.agentProviders }),
    };
});

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getActiveProvider: () => 'copilot',
}));

import { useModels, useModelConfig } from '../../../../src/server/spa/client/react/hooks/useModels';
import { useProviderModels } from '../../../../src/server/spa/client/react/hooks/useProviderModels';
import { useProviderReasoningEfforts } from '../../../../src/server/spa/client/react/hooks/useProviderReasoningEfforts';
import { useProviderEffortTiers } from '../../../../src/server/spa/client/react/hooks/useProviderEffortTiers';
import {
    _clearConfigCache,
    peekConfig,
    configCacheKey,
} from '../../../../src/server/spa/client/react/api/staticConfigCache';

beforeEach(() => {
    _clearConfigCache();
    for (const fn of Object.values(mocks.agentProviders)) fn.mockReset();
});
afterEach(() => { vi.clearAllMocks(); });

describe('provider-config hooks share the static-config cache (AC-01)', () => {
    it('useModels fetches once per provider and serves a warm second open from cache', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [{ id: 'm1', name: 'M1' }] });

        const first = renderHook(() => useModels('copilot'));
        await waitFor(() => expect(first.result.current.loading).toBe(false));
        expect(first.result.current.models).toHaveLength(1);
        expect(mocks.agentProviders.listModels).toHaveBeenCalledTimes(1);
        first.unmount();

        // Warm reopen: loading is already false on the first render (seeded from
        // the cache) and no second network call is made.
        const second = renderHook(() => useModels('copilot'));
        expect(second.result.current.loading).toBe(false);
        expect(second.result.current.models).toHaveLength(1);
        expect(mocks.agentProviders.listModels).toHaveBeenCalledTimes(1);
    });

    it('useModels fetches a not-yet-seen provider exactly once', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'codex', models: [] });

        // 'copilot' is already cached but 'codex' is new — only codex fetches.
        const copilot = { provider: 'copilot', models: [] };
        mocks.agentProviders.listModels.mockResolvedValueOnce(copilot);
        const a = renderHook(() => useModels('copilot'));
        await waitFor(() => expect(a.result.current.loading).toBe(false));
        a.unmount();
        const callsAfterCopilot = mocks.agentProviders.listModels.mock.calls.length;

        const b = renderHook(() => useModels('codex'));
        await waitFor(() => expect(b.result.current.loading).toBe(false));
        expect(mocks.agentProviders.listModels).toHaveBeenCalledWith('codex');
        expect(mocks.agentProviders.listModels.mock.calls.length).toBe(callsAfterCopilot + 1);
    });

    it('useModels and useProviderModels share the per-provider models cache key', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [] });

        const a = renderHook(() => useModels('copilot'));
        await waitFor(() => expect(a.result.current.loading).toBe(false));
        a.unmount();

        const b = renderHook(() => useProviderModels('copilot'));
        await waitFor(() => expect(b.result.current.loading).toBe(false));
        // Shared cache → a single network call total across both hooks.
        expect(mocks.agentProviders.listModels).toHaveBeenCalledTimes(1);
    });

    it('useProviderReasoningEfforts serves a warm reopen synchronously from cache', async () => {
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({ reasoningEfforts: { 'model-a': 'high' } });

        const first = renderHook(() => useProviderReasoningEfforts('copilot'));
        await waitFor(() => expect(first.result.current).toEqual({ 'model-a': 'high' }));
        first.unmount();

        const second = renderHook(() => useProviderReasoningEfforts('copilot'));
        // Seeded from cache on the very first render — no empty-map flash.
        expect(second.result.current).toEqual({ 'model-a': 'high' });
        expect(mocks.agentProviders.getReasoningEfforts).toHaveBeenCalledTimes(1);
    });

    it('useProviderEffortTiers serves a warm reopen from cache without a loading flash', async () => {
        mocks.agentProviders.getEffortTiers.mockResolvedValue({ provider: 'copilot', effortTiers: {}, defaults: {} });

        const first = renderHook(() => useProviderEffortTiers('copilot'));
        await waitFor(() => expect(first.result.current.loading).toBe(false));
        first.unmount();

        const second = renderHook(() => useProviderEffortTiers('copilot'));
        expect(second.result.current.loading).toBe(false);
        expect(mocks.agentProviders.getEffortTiers).toHaveBeenCalledTimes(1);
    });
});

describe('settings mutations invalidate the cache (AC-05)', () => {
    it('useModels reload() invalidates the models key and refetches', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [] });

        const { result } = renderHook(() => useModels('copilot'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(mocks.agentProviders.listModels).toHaveBeenCalledTimes(1);

        act(() => { result.current.reload(); });
        await waitFor(() => expect(mocks.agentProviders.listModels).toHaveBeenCalledTimes(2));
    });

    it('useModelConfig.setReasoningEffort invalidates the reasoning-efforts key', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [{ id: 'a', name: 'A' }] });
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({ reasoningEfforts: {} });
        mocks.agentProviders.setReasoningEffort.mockResolvedValue({ reasoningEfforts: { a: 'high' } });

        const { result } = renderHook(() => useModelConfig());
        await waitFor(() => expect(result.current.loading).toBe(false));
        await waitFor(() => expect(peekConfig(configCacheKey.reasoningEfforts('copilot'))).toBeDefined());

        await act(async () => { await result.current.setReasoningEffort('a', 'high'); });

        expect(peekConfig(configCacheKey.reasoningEfforts('copilot'))).toBeUndefined();
    });

    it('useProviderEffortTiers.save() invalidates the cache so the next open refetches', async () => {
        mocks.agentProviders.getEffortTiers.mockResolvedValue({ provider: 'copilot', effortTiers: {}, defaults: {} });
        mocks.agentProviders.replaceEffortTiers.mockResolvedValue({
            provider: 'copilot',
            effortTiers: { high: { model: 'x', reasoningEffort: 'high', source: 'config' } },
            defaults: {},
        });

        const first = renderHook(() => useProviderEffortTiers('copilot'));
        await waitFor(() => expect(first.result.current.loading).toBe(false));

        act(() => { first.result.current.setTier('high', 'x', 'high'); });
        await act(async () => { await first.result.current.save(); });

        expect(peekConfig(configCacheKey.effortTiers('copilot'))).toBeUndefined();
        first.unmount();

        const second = renderHook(() => useProviderEffortTiers('copilot'));
        await waitFor(() => expect(second.result.current.loading).toBe(false));
        // The save dropped the key, so reopening refetches (2 GETs total).
        expect(mocks.agentProviders.getEffortTiers).toHaveBeenCalledTimes(2);
    });

    it('useProviderEffortTiers.reload() invalidates the cache and refetches', async () => {
        mocks.agentProviders.getEffortTiers
            .mockResolvedValueOnce({ provider: 'copilot', effortTiers: {}, defaults: {} })
            .mockResolvedValueOnce({
                provider: 'copilot',
                effortTiers: { medium: { model: 'mid', reasoningEffort: 'medium', source: 'config' } },
                defaults: {},
            });

        const { result } = renderHook(() => useProviderEffortTiers('copilot'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.tiers.medium).toBeUndefined();

        act(() => { result.current.reload(); });
        await waitFor(() => expect(result.current.tiers.medium?.model).toBe('mid'));
        expect(mocks.agentProviders.getEffortTiers).toHaveBeenCalledTimes(2);
    });
});
