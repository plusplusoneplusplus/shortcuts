/**
 * Tests for useModels — fetches model list from /models API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useModels } from '../../../../src/server/spa/client/react/hooks/useModels';

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as any;

function makeModelResponse(models: any[]) {
    return {
        ok: true,
        json: async () => models,
    } as Response;
}

describe('useModels', () => {
    beforeEach(() => { fetchMock.mockReset(); });
    afterEach(() => { vi.clearAllMocks(); });

    it('starts with loading=true and empty models', () => {
        fetchMock.mockReturnValue(new Promise(() => {})); // never resolves
        const { result } = renderHook(() => useModels());
        expect(result.current.loading).toBe(true);
        expect(result.current.models).toEqual([]);
    });

    it('fetches models from GET /api/models on mount', async () => {
        fetchMock.mockResolvedValue(makeModelResponse([]));
        renderHook(() => useModels());
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/models'));
    });

    it('returns parsed model list and loading=false after fetch', async () => {
        const rawModels = [
            {
                id: 'gpt-4',
                name: 'GPT-4',
                capabilities: { limits: { max_context_window_tokens: 8192 } },
            },
        ];
        fetchMock.mockResolvedValue(makeModelResponse(rawModels));
        const { result } = renderHook(() => useModels());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toHaveLength(1);
        expect(result.current.models[0]).toEqual({
            id: 'gpt-4',
            name: 'GPT-4',
            tokenLimit: 8192,
        });
    });

    it('returns empty models on non-ok response', async () => {
        fetchMock.mockResolvedValue({ ok: false, json: async () => [] } as Response);
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
    });

    it('returns empty models on fetch error', async () => {
        fetchMock.mockRejectedValue(new Error('network error'));
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
    });

    it('defaults tokenLimit to 0 when capabilities are missing', async () => {
        fetchMock.mockResolvedValue(makeModelResponse([{ id: 'basic', name: 'Basic' }]));
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models[0].tokenLimit).toBe(0);
    });

    it('handles non-array response gracefully', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => null } as any);
        const { result } = renderHook(() => useModels());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.models).toEqual([]);
    });
});
