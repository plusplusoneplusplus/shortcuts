/**
 * AC-05: per-session TTFT/TPS display in the conversation metadata popover.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConversationMetadataPopover } from '../../../../../src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover';
import { deriveSessionTurnPerformance } from '../../../../../src/server/spa/client/react/features/chat/hooks/useSessionTurnPerformance';
import type { TurnPerformanceStatsResponse, TurnPerformanceGroup } from '@plusplusoneplusplus/coc-client';

const mockTurnPerformance = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        stats: {
            turnPerformance: mockTurnPerformance,
        },
    }),
}));

function makeGroup(turnIndex: number, ttftP50: number | null, tpsP50: number | null): TurnPerformanceGroup {
    return {
        key: { turnIndex },
        turnCount: 1,
        ttftMs: { p50: ttftP50, p90: ttftP50, p99: ttftP50, mean: ttftP50, min: ttftP50, max: ttftP50, n: ttftP50 == null ? 0 : 1 },
        tpsGeneration: { p50: tpsP50, p90: tpsP50, p99: tpsP50, mean: tpsP50, min: tpsP50, max: tpsP50, n: tpsP50 == null ? 0 : 1 },
        tpsWall: { p50: tpsP50, p90: tpsP50, p99: tpsP50, mean: tpsP50, min: tpsP50, max: tpsP50, n: tpsP50 == null ? 0 : 1 },
        outputTokens: 100,
    };
}

function makeResponse(groups: TurnPerformanceGroup[]): TurnPerformanceStatsResponse {
    return {
        groups,
        groupBy: ['turnIndex'],
        days: null,
        totalEvents: groups.length,
        excludedEvents: { nonCompleted: 0, noFirstToken: 0, noTokenUsage: 0 },
        generatedAt: '2026-08-20T10:00:00.000Z',
    };
}

const PROCESS = { id: 'proc-perf-1', type: 'chat', status: 'completed' };

async function openPopover() {
    render(<ConversationMetadataPopover process={PROCESS} />);
    const trigger = screen.getByRole('button', { name: /conversation metadata/i });
    await act(async () => {
        fireEvent.click(trigger);
    });
}

describe('deriveSessionTurnPerformance', () => {
    it('returns null for empty, missing, or malformed groups', () => {
        expect(deriveSessionTurnPerformance(null)).toBeNull();
        expect(deriveSessionTurnPerformance(undefined)).toBeNull();
        expect(deriveSessionTurnPerformance(makeResponse([]))).toBeNull();
        expect(deriveSessionTurnPerformance({} as TurnPerformanceStatsResponse)).toBeNull();
    });

    it('picks the turnIndex=0 group TTFT and the median TPS across turns (odd count)', () => {
        const result = deriveSessionTurnPerformance(makeResponse([
            makeGroup(0, 3200, 30),
            makeGroup(1, 900, 10),
            makeGroup(2, 1100, 20),
        ]));
        expect(result).toEqual({ firstTurnTtftMs: 3200, medianTpsGeneration: 20, turnCount: 3 });
    });

    it('averages the middle pair for an even turn count', () => {
        const result = deriveSessionTurnPerformance(makeResponse([
            makeGroup(0, 3200, 10),
            makeGroup(1, 900, 20),
        ]));
        expect(result?.medianTpsGeneration).toBe(15);
    });

    it('handles a session without a turn-0 row (resumed session) — TTFT null, TPS present', () => {
        const result = deriveSessionTurnPerformance(makeResponse([
            makeGroup(3, 800, 25),
        ]));
        expect(result).toEqual({ firstTurnTtftMs: null, medianTpsGeneration: 25, turnCount: 1 });
    });

    it('handles turns with no token usage — TTFT present, TPS null', () => {
        const result = deriveSessionTurnPerformance(makeResponse([
            makeGroup(0, 3200, null),
        ]));
        expect(result).toEqual({ firstTurnTtftMs: 3200, medianTpsGeneration: null, turnCount: 1 });
    });

    it('returns null when every metric is null', () => {
        expect(deriveSessionTurnPerformance(makeResponse([makeGroup(0, null, null)]))).toBeNull();
    });

    it('matches a string turnIndex key from the wire', () => {
        const group = makeGroup(0, 1500, 12);
        group.key = { turnIndex: '0' };
        expect(deriveSessionTurnPerformance(makeResponse([group]))?.firstTurnTtftMs).toBe(1500);
    });
});

describe('SessionPerformanceRows (via ConversationMetadataPopover)', () => {
    beforeEach(() => {
        mockTurnPerformance.mockReset();
    });

    it('renders first-turn TTFT and median TPS for the current process', async () => {
        mockTurnPerformance.mockResolvedValue(makeResponse([
            makeGroup(0, 3200, 30),
            makeGroup(1, 900, 20),
            makeGroup(2, 1100, 25),
        ]));
        await openPopover();

        expect(await screen.findByText('Performance')).toBeDefined();
        expect(screen.getByText('First token: 3.2s · Median TPS: 25.0')).toBeDefined();
        expect(mockTurnPerformance).toHaveBeenCalledWith({
            processId: 'proc-perf-1',
            groupBy: 'turnIndex',
        });
    });

    it('formats sub-second TTFT in milliseconds', async () => {
        mockTurnPerformance.mockResolvedValue(makeResponse([makeGroup(0, 780, null)]));
        await openPopover();

        expect(await screen.findByText('First token: 780 ms')).toBeDefined();
    });

    it('hides cleanly when the session has no recorded metrics', async () => {
        mockTurnPerformance.mockResolvedValue(makeResponse([]));
        await openPopover();

        expect(screen.getByText('Conversation metadata')).toBeDefined();
        expect(screen.queryByText('Performance')).toBeNull();
    });

    it('hides cleanly when the stats fetch fails', async () => {
        mockTurnPerformance.mockRejectedValue(new Error('boom'));
        await openPopover();

        expect(screen.getByText('Conversation metadata')).toBeDefined();
        expect(screen.queryByText('Performance')).toBeNull();
    });
});
