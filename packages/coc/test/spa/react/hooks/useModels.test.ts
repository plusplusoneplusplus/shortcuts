/**
 * Tests for useModels — fetches model list from /models API via typed cocClient.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useModels, useModelConfig } from '../../../../src/server/spa/client/react/hooks/useModels';

const mocks = vi.hoisted(() => ({
    models: {
        list: vi.fn(),
        setEnabled: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/api/cocClient')>();
    return {
        ...actual,
        getSpaCocClient: () => ({ models: mocks.models }),
    };
});

describe('useModels', () => {
    beforeEach(() => { mocks.models.list.mockReset(); mocks.models.setEnabled.mockReset(); });
    afterEach(() => { vi.clearAllMocks(); });

    it('starts with loading=true and empty models', () => {
        mocks.models.list.mockReturnValue(new Promise(() => {})); // never resolves
        const { result } = renderHook(() => useModels());
        expect(result.current.loading).toBe(true);
        expect(result.current.models).toEqual([]);
    });

    it('fetches models via cocClient.models.list() on mount', async () => {
        mocks.models.list.mockResolvedValue([]);
        renderHook(() => useModels());
        await waitFor(() => expect(mocks.models.list).toHaveBeenCalled());
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
        mocks.models.list.mockResolvedValue(rawModels);
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
        });
    });

    it('returns empty models on rejection and sets error', async () => {
        mocks.models.list.mockRejectedValue(new Error('HTTP 500'));
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
        expect(result.current.error).toBe('HTTP 500');
    });

    it('returns empty models on fetch error and sets error', async () => {
        mocks.models.list.mockRejectedValue(new Error('network error'));
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
        expect(result.current.error).toBe('network error');
    });

    it('defaults tokenLimit to 0 and enabled to false when capabilities are missing', async () => {
        mocks.models.list.mockResolvedValue([{ id: 'basic', name: 'Basic' }]);
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0].tokenLimit).toBe(0);
        expect(result.current.models[0].enabled).toBe(false);
        expect(result.current.models[0].capabilities?.supports?.vision).toBe(false);
    });

    it('handles non-array response gracefully', async () => {
        mocks.models.list.mockResolvedValue(null);
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
    });

    it('reload clears error and re-fetches', async () => {
        mocks.models.list.mockRejectedValueOnce(new Error('fail'));
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('fail');

        mocks.models.list.mockResolvedValueOnce([{ id: 'm1', name: 'M1' }]);
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
        mocks.models.list.mockResolvedValue(raw);
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0].capabilities?.supports?.vision).toBe(true);
        expect(result.current.models[0].capabilities?.supports?.reasoningEffort).toBe(true);
    });
});

describe('useModelConfig', () => {
    beforeEach(() => { mocks.models.list.mockReset(); mocks.models.setEnabled.mockReset(); });
    afterEach(() => { vi.clearAllMocks(); });

    it('toggleModel calls models.setEnabled with PUT semantics', async () => {
        mocks.models.list.mockResolvedValue([
            { id: 'a', name: 'A', enabled: true },
            { id: 'b', name: 'B', enabled: false },
        ]);
        mocks.models.setEnabled.mockResolvedValue({ enabledModels: ['a'] });

        const { result } = renderHook(() => useModelConfig());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.toggleModel('b', true);
        });

        expect(mocks.models.setEnabled).toHaveBeenCalledWith(
            expect.arrayContaining(['a', 'b'])
        );
    });
});
