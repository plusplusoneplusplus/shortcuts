/**
 * Tests for useModels — fetches model list from provider-scoped API via agentProviders.listModels().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useModels, useModelConfig } from '../../../../src/server/spa/client/react/hooks/useModels';

const mocks = vi.hoisted(() => ({
    agentProviders: {
        listModels: vi.fn(),
        setEnabledModels: vi.fn(),
        getReasoningEfforts: vi.fn(),
        setReasoningEffort: vi.fn(),
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

describe('useModels', () => {
    beforeEach(() => { mocks.agentProviders.listModels.mockReset(); mocks.agentProviders.setEnabledModels.mockReset(); });
    afterEach(() => { vi.clearAllMocks(); });

    it('starts with loading=true and empty models', () => {
        mocks.agentProviders.listModels.mockReturnValue(new Promise(() => {})); // never resolves
        const { result } = renderHook(() => useModels());
        expect(result.current.loading).toBe(true);
        expect(result.current.models).toEqual([]);
    });

    it('fetches models via agentProviders.listModels(activeProvider) on mount', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [] });
        renderHook(() => useModels());
        await waitFor(() => expect(mocks.agentProviders.listModels).toHaveBeenCalledWith('copilot'));
    });

    it('returns parsed model list and loading=false after fetch', async () => {
        const rawModels = [
            {
                id: 'gpt-4',
                name: 'GPT-4',
                enabled: true,
                capabilities: { limits: { max_context_window_tokens: 8192 } },
            },
        ];
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: rawModels });
        const { result } = renderHook(() => useModels());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toHaveLength(1);
        expect(result.current.models[0]).toEqual({
            id: 'gpt-4',
            name: 'GPT-4',
            tokenLimit: 8192,
            enabled: true,
            capabilities: {
                supports: { vision: false, reasoningEffort: false },
                limits: { max_context_window_tokens: 8192, max_prompt_tokens: undefined },
            },
            supportedReasoningEfforts: [],
            defaultReasoningEffort: undefined,
        });
    });

    it('returns empty models on rejection and sets error', async () => {
        mocks.agentProviders.listModels.mockRejectedValue(new Error('HTTP 500'));
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
        expect(result.current.error).toBe('HTTP 500');
    });

    it('returns empty models on fetch error and sets error', async () => {
        mocks.agentProviders.listModels.mockRejectedValue(new Error('network error'));
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
        expect(result.current.error).toBe('network error');
    });

    it('defaults tokenLimit to 0 and enabled to false when capabilities are missing', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [{ id: 'basic', name: 'Basic' }] });
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0].tokenLimit).toBe(0);
        expect(result.current.models[0].enabled).toBe(false);
        expect(result.current.models[0].capabilities?.supports?.vision).toBe(false);
    });

    it('handles non-array models response gracefully', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: null });
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
    });

    it('reload clears error and re-fetches', async () => {
        mocks.agentProviders.listModels.mockRejectedValueOnce(new Error('fail'));
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('fail');

        mocks.agentProviders.listModels.mockResolvedValueOnce({ provider: 'copilot', models: [{ id: 'm1', name: 'M1' }] });
        result.current.reload();
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe(null);
        expect(result.current.models).toHaveLength(1);
    });

    it('exposes vision and reasoning capabilities', async () => {
        const raw = [{
            id: 'vision-model',
            name: 'Vision',
            capabilities: {
                supports: { vision: true, reasoningEffort: true },
                limits: { max_context_window_tokens: 200000 },
            },
        }];
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: raw });
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0].capabilities?.supports?.vision).toBe(true);
        expect(result.current.models[0].capabilities?.supports?.reasoningEffort).toBe(true);
    });

    it('exposes supportedReasoningEfforts from raw CAPI capability metadata', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [{
            id: 'reasoning-model',
            name: 'Reasoning',
            capabilities: {
                supports: {
                    vision: false,
                    reasoningEffort: true,
                    reasoning_effort: ['low', 'medium', 'high'],
                },
                limits: { max_context_window_tokens: 200000 },
            },
            defaultReasoningEffort: 'high',
        }]});
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0].supportedReasoningEfforts).toEqual(['low', 'medium', 'high']);
        expect(result.current.models[0].defaultReasoningEffort).toBe('high');
    });

    it('falls back to top-level supportedReasoningEfforts when raw metadata is absent', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [{
            id: 'reasoning-model',
            name: 'Reasoning',
            capabilities: {
                supports: { vision: false, reasoningEffort: true },
                limits: { max_context_window_tokens: 200000 },
            },
            supportedReasoningEfforts: ['medium', 'high', 'xhigh'],
            defaultReasoningEffort: 'medium',
        }]});
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0].supportedReasoningEfforts).toEqual(['medium', 'high', 'xhigh']);
        expect(result.current.models[0].defaultReasoningEffort).toBe('medium');
    });

    it('canonicalizes reasoning effort order, dedupes, and ignores unknown values', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [{
            id: 'noisy-model',
            name: 'Noisy',
            capabilities: {
                supports: {
                    vision: false,
                    reasoningEffort: true,
                    reasoning_effort: ['high', 'low', 'bogus', 'medium', 'high', 42],
                },
                limits: { max_context_window_tokens: 200000 },
            },
        }]});
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0].supportedReasoningEfforts).toEqual(['low', 'medium', 'high']);
    });

    it('infers reasoningEffort=true when the supported list is non-empty', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [{
            id: 'implicit-reasoning',
            name: 'Implicit',
            capabilities: {
                supports: {
                    vision: false,
                    reasoningEffort: false,
                    reasoning_effort: ['low', 'high'],
                },
                limits: { max_context_window_tokens: 128000 },
            },
        }]});
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0].capabilities?.supports?.reasoningEffort).toBe(true);
        expect(result.current.models[0].supportedReasoningEfforts).toEqual(['low', 'high']);
    });

    it('drops defaultReasoningEffort when it is not in the supported list', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [{
            id: 'misconfigured',
            name: 'Misconfigured',
            capabilities: {
                supports: {
                    vision: false,
                    reasoningEffort: true,
                    reasoning_effort: ['low', 'medium'],
                },
                limits: { max_context_window_tokens: 128000 },
            },
            defaultReasoningEffort: 'xhigh',
        }]});
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0].defaultReasoningEffort).toBeUndefined();
    });

    it('returns empty supportedReasoningEfforts when no reasoning metadata is present', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [{
            id: 'plain',
            name: 'Plain',
            capabilities: {
                supports: { vision: false, reasoningEffort: false },
                limits: { max_context_window_tokens: 8192 },
            },
        }]});
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0].supportedReasoningEfforts).toEqual([]);
        expect(result.current.models[0].defaultReasoningEffort).toBeUndefined();
    });
});

describe('useModelConfig', () => {
    beforeEach(() => {
        mocks.agentProviders.listModels.mockReset();
        mocks.agentProviders.setEnabledModels.mockReset();
        mocks.agentProviders.getReasoningEfforts.mockReset();
        mocks.agentProviders.setReasoningEffort.mockReset();
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({ reasoningEfforts: {} });
    });
    afterEach(() => { vi.clearAllMocks(); });

    it('toggleModel calls agentProviders.setEnabledModels with active provider', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [
            { id: 'a', name: 'A', enabled: true },
            { id: 'b', name: 'B', enabled: false },
        ]});
        mocks.agentProviders.setEnabledModels.mockResolvedValue({ enabledModels: ['a'] });

        const { result } = renderHook(() => useModelConfig());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.toggleModel('b', true);
        });

        expect(mocks.agentProviders.setEnabledModels).toHaveBeenCalledWith(
            'copilot',
            expect.arrayContaining(['a', 'b'])
        );
    });

    it('loads persisted reasoning efforts on mount via agentProviders', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [] });
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({ reasoningEfforts: { 'model-a': 'high' } });

        const { result } = renderHook(() => useModelConfig());
        await waitFor(() => expect(result.current.loading).toBe(false));
        await waitFor(() => expect(result.current.reasoningEfforts).toEqual({ 'model-a': 'high' }));
        expect(mocks.agentProviders.getReasoningEfforts).toHaveBeenCalledWith('copilot');
    });

    it('setReasoningEffort calls agentProviders.setReasoningEffort and updates local state', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [
            { id: 'model-a', name: 'A', enabled: true },
        ]});
        mocks.agentProviders.setReasoningEffort.mockResolvedValue({ reasoningEfforts: { 'model-a': 'xhigh' } });

        const { result } = renderHook(() => useModelConfig());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.setReasoningEffort('model-a', 'xhigh');
        });

        expect(mocks.agentProviders.setReasoningEffort).toHaveBeenCalledWith('copilot', 'model-a', 'xhigh');
        expect(result.current.reasoningEfforts['model-a']).toBe('xhigh');
    });

    it('setReasoningEffort with empty string removes the override', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [] });
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({ reasoningEfforts: { 'model-a': 'high' } });
        mocks.agentProviders.setReasoningEffort.mockResolvedValue({ reasoningEfforts: {} });

        const { result } = renderHook(() => useModelConfig());
        await waitFor(() => expect(result.current.reasoningEfforts).toEqual({ 'model-a': 'high' }));

        await act(async () => {
            await result.current.setReasoningEffort('model-a', '');
        });

        expect(mocks.agentProviders.setReasoningEffort).toHaveBeenCalledWith('copilot', 'model-a', '');
        expect(result.current.reasoningEfforts['model-a']).toBeUndefined();
    });

    it('reverts optimistic update on setReasoningEffort failure', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [] });
        mocks.agentProviders.getReasoningEfforts.mockResolvedValue({ reasoningEfforts: {} });
        mocks.agentProviders.setReasoningEffort.mockRejectedValue(new Error('fail'));

        const { result } = renderHook(() => useModelConfig());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.setReasoningEffort('model-a', 'high');
        });

        // Should revert to empty since that was the state before the call
        expect(result.current.reasoningEfforts['model-a']).toBeUndefined();
    });

    it('returns empty reasoningEfforts when getReasoningEfforts fails', async () => {
        mocks.agentProviders.listModels.mockResolvedValue({ provider: 'copilot', models: [] });
        mocks.agentProviders.getReasoningEfforts.mockRejectedValue(new Error('fail'));

        const { result } = renderHook(() => useModelConfig());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.reasoningEfforts).toEqual({});
    });
});
