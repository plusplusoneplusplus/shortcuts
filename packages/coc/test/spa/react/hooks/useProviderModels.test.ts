/**
 * Tests for useProviderModels — provider-scoped model hooks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useProviderModels, useProviderModelConfig } from '../../../../src/server/spa/client/react/hooks/useProviderModels';

const mocks = vi.hoisted(() => ({
    agentProviders: {
        listModels: vi.fn(),
        getEnabledModels: vi.fn(),
        setEnabledModels: vi.fn(),
        getReasoningEfforts: vi.fn(),
        setReasoningEffort: vi.fn(),
        queryModel: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/api/cocClient')>();
    return {
        ...actual,
        getSpaCocClient: () => ({ agentProviders: mocks.agentProviders }),
    };
});

describe('useProviderModels', () => {
    beforeEach(() => {
        mocks.agentProviders.listModels.mockReset();
    });
    afterEach(() => { vi.clearAllMocks(); });

    it('starts with loading=true and empty models', () => {
        mocks.agentProviders.listModels.mockReturnValue(new Promise(() => {}));
        const { result } = renderHook(() => useProviderModels('copilot'));
        expect(result.current.loading).toBe(true);
        expect(result.current.models).toEqual([]);
    });

    it('fetches models via agentProviders.listModels(provider) on mount', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [] });
        renderHook(() => useProviderModels('copilot'));
        await waitFor(() => expect(mocks.agentProviders.listModels).toHaveBeenCalledWith('copilot'));
    });

    it('returns parsed model list for a provider', async () => {
        const rawModels = [
            {
                id: 'gpt-5',
                name: 'GPT-5',
                enabled: true,
                capabilities: { limits: { max_context_window_tokens: 128000 } },
            },
        ];
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: rawModels });
        const { result } = renderHook(() => useProviderModels('copilot'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toHaveLength(1);
        expect(result.current.models[0]).toMatchObject({
            id: 'gpt-5',
            name: 'GPT-5',
            tokenLimit: 128000,
            enabled: true,
        });
    });

    it('re-fetches when provider changes', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [] });
        const { rerender } = renderHook(
            ({ provider }) => useProviderModels(provider),
            { initialProps: { provider: 'copilot' as const } },
        );
        await waitFor(() => expect(mocks.agentProviders.listModels).toHaveBeenCalledWith('copilot'));

        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'codex', models: [{ id: 'codex-1', name: 'Codex 1' }] });
        rerender({ provider: 'codex' as const });
        await waitFor(() => expect(mocks.agentProviders.listModels).toHaveBeenCalledWith('codex'));
    });

    it('returns error when fetch fails', async () => {
        mocks.agentProviders.listModels.mockRejectedValue(new Error('Not found'));
        const { result } = renderHook(() => useProviderModels('claude'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
        expect(result.current.error).toBe('Not found');
    });

    it('handles null response gracefully', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: null });
        const { result } = renderHook(() => useProviderModels('copilot'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
    });

    it('normalizes reasoning efforts from CAPI metadata', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'copilot',
            models: [{
                id: 'reasoning-model',
                name: 'Reasoning',
                capabilities: {
                    supports: { reasoning_effort: ['high', 'low', 'medium'] },
                    limits: { max_context_window_tokens: 200000 },
                },
                defaultReasoningEffort: 'high',
            }],
        });
        const { result } = renderHook(() => useProviderModels('copilot'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0].supportedReasoningEfforts).toEqual(['low', 'medium', 'high']);
        expect(result.current.models[0].defaultReasoningEffort).toBe('high');
    });

    it('reload clears error and re-fetches', async () => {
        mocks.agentProviders.listModels.mockRejectedValueOnce(new Error('fail'));
        const { result } = renderHook(() => useProviderModels('copilot'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('fail');

        mocks.agentProviders.listModels.mockResolvedValueOnce({ provider: 'copilot', models: [{ id: 'm1', name: 'M1' }] });
        result.current.reload();
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe(null);
        expect(result.current.models).toHaveLength(1);
    });
});

describe('useProviderModelConfig', () => {
    beforeEach(() => {
        mocks.agentProviders.listModels.mockReset();
        mocks.agentProviders.setEnabledModels.mockReset();
        mocks.agentProviders.getReasoningEfforts.mockReset();
        mocks.agentProviders.setReasoningEffort.mockReset();
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({ provider: 'copilot', reasoningEfforts: {} });
    });
    afterEach(() => { vi.clearAllMocks(); });

    it('toggleModel calls agentProviders.setEnabledModels with provider', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'copilot',
            models: [
                { id: 'a', name: 'A', enabled: true },
                { id: 'b', name: 'B', enabled: false },
            ],
        });
        mocks.agentProviders.setEnabledModels.mockResolvedValue({ provider: 'copilot', enabledModels: ['a', 'b'] });

        const { result } = renderHook(() => useProviderModelConfig('copilot'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.toggleModel('b', true);
        });

        expect(mocks.agentProviders.setEnabledModels).toHaveBeenCalledWith(
            'copilot',
            expect.arrayContaining(['a', 'b']),
        );
    });

    it('loads provider-scoped reasoning efforts on mount', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [] });
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({
            provider: 'copilot',
            reasoningEfforts: { 'model-a': 'high' },
        });

        const { result } = renderHook(() => useProviderModelConfig('copilot'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await waitFor(() => expect(result.current.reasoningEfforts).toEqual({ 'model-a': 'high' }));
        expect(mocks.agentProviders.getReasoningEfforts).toHaveBeenCalledWith('copilot');
    });

    it('setReasoningEffort calls provider-scoped endpoint', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({
            provider: 'copilot',
            models: [{ id: 'model-a', name: 'A', enabled: true }],
        });
        mocks.agentProviders.setReasoningEffort.mockResolvedValue({
            provider: 'copilot',
            reasoningEfforts: { 'model-a': 'xhigh' },
        });

        const { result } = renderHook(() => useProviderModelConfig('copilot'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.setReasoningEffort('model-a', 'xhigh');
        });

        expect(mocks.agentProviders.setReasoningEffort).toHaveBeenCalledWith('copilot', 'model-a', 'xhigh');
        expect(result.current.reasoningEfforts['model-a']).toBe('xhigh');
    });

    it('reverts reasoning effort on failure', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [] });
        mocks.agentProviders.setReasoningEffort.mockRejectedValue(new Error('fail'));

        const { result } = renderHook(() => useProviderModelConfig('copilot'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.setReasoningEffort('model-a', 'high');
        });

        expect(result.current.reasoningEfforts['model-a']).toBeUndefined();
    });

    it('setReasoningEffort with empty string removes the override', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [] });
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({
            provider: 'copilot',
            reasoningEfforts: { 'model-a': 'high' },
        });
        mocks.agentProviders.setReasoningEffort.mockResolvedValue({
            provider: 'copilot',
            reasoningEfforts: {},
        });

        const { result } = renderHook(() => useProviderModelConfig('copilot'));
        await waitFor(() => expect(result.current.reasoningEfforts).toEqual({ 'model-a': 'high' }));

        await act(async () => {
            await result.current.setReasoningEffort('model-a', '');
        });

        expect(mocks.agentProviders.setReasoningEffort).toHaveBeenCalledWith('copilot', 'model-a', '');
        expect(result.current.reasoningEfforts['model-a']).toBeUndefined();
    });

    it('providers are isolated — different providers get different calls', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'codex', models: [] });
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({ provider: 'codex', reasoningEfforts: {} });

        renderHook(() => useProviderModelConfig('codex'));
        await waitFor(() => expect(mocks.agentProviders.listModels).toHaveBeenCalledWith('codex'));
        expect(mocks.agentProviders.getReasoningEfforts).toHaveBeenCalledWith('codex');
    });
});
