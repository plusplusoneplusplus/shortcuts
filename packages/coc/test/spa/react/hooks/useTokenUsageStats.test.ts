/**
 * Tests for useTokenUsageStats hook.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTokenUsageStats } from '../../../../src/server/spa/client/react/features/chat/hooks/useTokenUsageStats';
import type { ClientTokenUsageStatsResponse } from '../../../../src/server/spa/client/react/types/dashboard';

const mockTokenUsage = vi.fn();

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        stats: {
            tokenUsage: mockTokenUsage,
        },
    }),
}));

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
        mockTokenUsage.mockReset();
    });

    it('returns data matching ClientTokenUsageStatsResponse shape on successful fetch', async () => {
        const response = makeResponse();
        mockTokenUsage.mockResolvedValue(response);

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
        mockTokenUsage.mockReturnValue(pending);

        const { result } = renderHook(() => useTokenUsageStats());

        // loading should become true before resolution
        await waitFor(() => expect(result.current.loading).toBe(true));

        resolve(makeResponse());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.data).not.toBeNull();
    });

    it('sets error when fetchApi throws, data remains null', async () => {
        mockTokenUsage.mockRejectedValue(new Error('network failure'));

        const { result } = renderHook(() => useTokenUsageStats());

        await waitFor(() => expect(result.current.error).not.toBeNull());

        expect(result.current.error).toContain('network failure');
        expect(result.current.data).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    it('calls typed stats client without a days query when days is undefined', async () => {
        mockTokenUsage.mockResolvedValue(makeResponse());

        const { result } = renderHook(() => useTokenUsageStats());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockTokenUsage).toHaveBeenCalledWith(undefined);
    });

    it('calls typed stats client with days when days=30', async () => {
        mockTokenUsage.mockResolvedValue(makeResponse({ totalDays: 30 }));

        const { result } = renderHook(() => useTokenUsageStats(30));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockTokenUsage).toHaveBeenCalledWith({ days: 30 });
    });

    it('re-fetches with updated URL when days changes', async () => {
        mockTokenUsage.mockResolvedValue(makeResponse());

        const { result, rerender } = renderHook(
            ({ days }) => useTokenUsageStats(days),
            { initialProps: { days: undefined as number | undefined } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockTokenUsage).toHaveBeenLastCalledWith(undefined);

        rerender({ days: 14 });
        await waitFor(() => expect(mockTokenUsage).toHaveBeenCalledWith({ days: 14 }));
    });
});
