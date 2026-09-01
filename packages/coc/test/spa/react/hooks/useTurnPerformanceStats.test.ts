import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTurnPerformanceStats } from '../../../../src/server/spa/client/react/features/stats/hooks/useTurnPerformanceStats';
import type { TurnPerformanceStatsResponse } from '@plusplusoneplusplus/coc-client';

const mockTurnPerformance = vi.fn();

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        stats: {
            turnPerformance: mockTurnPerformance,
        },
    }),
}));

function makeResponse(overrides?: Partial<TurnPerformanceStatsResponse>): TurnPerformanceStatsResponse {
    return {
        groups: [
            {
                key: { provider: 'claude' },
                turnCount: 3,
                ttftMs: { p50: 3200, p90: 8100, p99: 19400, mean: 4310, min: 780, max: 24000, n: 3 },
                tpsGeneration: { p50: 27.4, p90: 41.2, p99: 52.0, mean: 28.9, min: 3.1, max: 60.2, n: 3 },
                tpsWall: { p50: 24.1, p90: 37.0, p99: 48.3, mean: 25.6, min: 2.7, max: 55.9, n: 3 },
                outputTokens: 4200,
            },
        ],
        groupBy: ['provider'],
        days: 30,
        totalEvents: 3,
        excludedEvents: { nonCompleted: 0, noFirstToken: 0, noTokenUsage: 0 },
        generatedAt: '2026-08-20T10:00:00.000Z',
        ...overrides,
    };
}

describe('useTurnPerformanceStats', () => {
    beforeEach(() => {
        mockTurnPerformance.mockReset();
    });

    it('goes loading → data on a successful fetch', async () => {
        let resolve!: (v: TurnPerformanceStatsResponse) => void;
        const pending = new Promise<TurnPerformanceStatsResponse>(r => { resolve = r; });
        mockTurnPerformance.mockReturnValue(pending);

        const { result } = renderHook(() => useTurnPerformanceStats(30, 'provider', false));

        await waitFor(() => expect(result.current.loading).toBe(true));
        expect(result.current.data).toBeNull();

        resolve(makeResponse());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.data).not.toBeNull();
        expect(result.current.data!.groups).toHaveLength(1);
        expect(result.current.error).toBeNull();
    });

    it('sets error when the client throws, data remains null', async () => {
        mockTurnPerformance.mockRejectedValue(new Error('network failure'));

        const { result } = renderHook(() => useTurnPerformanceStats(30, 'provider', false));

        await waitFor(() => expect(result.current.error).not.toBeNull());
        expect(result.current.error).toContain('network failure');
        expect(result.current.data).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    it('clears a previous error on reload', async () => {
        mockTurnPerformance.mockRejectedValueOnce(new Error('boom'));
        mockTurnPerformance.mockResolvedValue(makeResponse());

        const { result } = renderHook(() => useTurnPerformanceStats(undefined, 'provider', false));
        await waitFor(() => expect(result.current.error).not.toBeNull());

        result.current.reload();
        await waitFor(() => expect(result.current.error).toBeNull());
        expect(result.current.data).not.toBeNull();
    });

    it('passes groupBy only when days is undefined and firstTurnOnly is false', async () => {
        mockTurnPerformance.mockResolvedValue(makeResponse({ days: null }));

        const { result } = renderHook(() => useTurnPerformanceStats(undefined, 'model', false));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockTurnPerformance).toHaveBeenCalledWith({ groupBy: 'model' });
    });

    it('passes days and firstTurnOnly when set', async () => {
        mockTurnPerformance.mockResolvedValue(makeResponse());

        const { result } = renderHook(() => useTurnPerformanceStats(7, 'kind', true));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockTurnPerformance).toHaveBeenCalledWith({ groupBy: 'kind', days: 7, firstTurnOnly: true });
    });

    it('re-fetches when a parameter changes', async () => {
        mockTurnPerformance.mockResolvedValue(makeResponse());

        const { result, rerender } = renderHook(
            ({ days }) => useTurnPerformanceStats(days, 'provider', false),
            { initialProps: { days: 30 as number | undefined } }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(mockTurnPerformance).toHaveBeenLastCalledWith({ groupBy: 'provider', days: 30 });

        rerender({ days: 7 });
        await waitFor(() => expect(mockTurnPerformance).toHaveBeenLastCalledWith({ groupBy: 'provider', days: 7 }));
    });
});
