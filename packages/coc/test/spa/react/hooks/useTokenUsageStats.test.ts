/**
 * Tests for useTokenUsageStats hook.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTokenUsageStats } from '../../../../src/server/spa/client/react/features/chat/hooks/useTokenUsageStats';
import type { ClientTokenUsageStatsResponse } from '../../../../src/server/spa/client/react/types/dashboard';

// Mock fetchApi
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));

import { fetchApi } from '../../../../src/server/spa/client/react/hooks/useApi';
const mockFetchApi = fetchApi as ReturnType<typeof vi.fn>;

function makeResponse(overrides?: Partial<ClientTokenUsageStatsResponse>): ClientTokenUsageStatsResponse {
    return {
        entries: [
            {
                date: '2024-01-01',
                byModel: {
                    'gpt-4': {
                        inputTokens: 100,
                        outputTokens: 50,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                        totalTokens: 150,
                        turnCount: 1,
                    },
                },
                dayTotal: {
                    inputTokens: 100,
                    outputTokens: 50,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    totalTokens: 150,
                    turnCount: 1,
                },
            },
        ],
        models: ['gpt-4'],
        generatedAt: '2024-01-02T00:00:00.000Z',
        totalDays: 7,
        ...overrides,
    };
}

describe('useTokenUsageStats', () => {
    beforeEach(() => {
        mockFetchApi.mockReset();
    });

    it('returns data matching ClientTokenUsageStatsResponse shape on successful fetch', async () => {
        const response = makeResponse();
        mockFetchApi.mockResolvedValue(response);

        const { result } = renderHook(() => useTokenUsageStats());

        await waitFor(() => expect(result.current.data).not.toBeNull());

        expect(result.current.data).toMatchObject({
            entries: expect.any(Array),
            models: expect.any(Array),
            generatedAt: expect.any(String),
            totalDays: expect.any(Number),
        });
        expect(result.current.error).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    it('sets loading=true while fetchApi is in-flight, then false after resolution', async () => {
        let resolve!: (v: ClientTokenUsageStatsResponse) => void;
        const pending = new Promise<ClientTokenUsageStatsResponse>(r => { resolve = r; });
        mockFetchApi.mockReturnValue(pending);

        const { result } = renderHook(() => useTokenUsageStats());

        // loading should become true before resolution
        await waitFor(() => expect(result.current.loading).toBe(true));

        resolve(makeResponse());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.data).not.toBeNull();
    });

    it('sets error when fetchApi throws, data remains null', async () => {
        mockFetchApi.mockRejectedValue(new Error('network failure'));

        const { result } = renderHook(() => useTokenUsageStats());

        await waitFor(() => expect(result.current.error).not.toBeNull());

        expect(result.current.error).toContain('network failure');
        expect(result.current.data).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    it('calls fetchApi with /stats/token-usage when days is undefined', async () => {
        mockFetchApi.mockResolvedValue(makeResponse());

        const { result } = renderHook(() => useTokenUsageStats());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockFetchApi).toHaveBeenCalledWith('/stats/token-usage');
    });

    it('calls fetchApi with /stats/token-usage?days=30 when days=30', async () => {
        mockFetchApi.mockResolvedValue(makeResponse({ totalDays: 30 }));

        const { result } = renderHook(() => useTokenUsageStats(30));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockFetchApi).toHaveBeenCalledWith('/stats/token-usage?days=30');
    });

    it('re-fetches with updated URL when days changes', async () => {
        mockFetchApi.mockResolvedValue(makeResponse());

        const { result, rerender } = renderHook(
            ({ days }) => useTokenUsageStats(days),
            { initialProps: { days: undefined as number | undefined } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockFetchApi).toHaveBeenLastCalledWith('/stats/token-usage');

        rerender({ days: 14 });
        await waitFor(() => expect(mockFetchApi).toHaveBeenCalledWith('/stats/token-usage?days=14'));
    });
});
