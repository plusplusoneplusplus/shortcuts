/**
 * Turn Performance Stats Aggregation Tests
 *
 * Pure-function tests for aggregateTurnPerformance:
 * - empty input
 * - single row
 * - percentile correctness against a hand-computed fixture
 * - each groupBy dimension + composite groupBy
 * - excludedEvents accounting (non-completed / no first token / no token usage)
 */

import { describe, it, expect } from 'vitest';
import {
    aggregateTurnPerformance,
    isTurnPerformanceGroupBy,
    TURN_PERFORMANCE_GROUP_BY_VALUES,
} from '../../src/ai/turn-performance-stats';
import type { TurnPerformanceEvent } from '../../src/ai/turn-performance-types';

let seq = 0;

function makeEvent(overrides: Partial<TurnPerformanceEvent> = {}): TurnPerformanceEvent {
    const turnIndex = overrides.turnIndex ?? 0;
    const processId = overrides.processId ?? `proc-${seq++}`;
    return {
        id: `${processId}:${turnIndex}`,
        processId,
        turnIndex,
        workspaceId: 'ws-1',
        provider: 'claude',
        model: 'claude-sonnet-5',
        effortTier: null,
        mode: 'autopilot',
        kind: 'chat',
        enqueuedAt: '2026-08-20T10:00:00.000Z',
        startedAt: '2026-08-20T10:00:01.000Z',
        firstOutputAt: '2026-08-20T10:00:03.000Z',
        endedAt: '2026-08-20T10:00:11.000Z',
        ttftMs: 2000,
        queueWaitMs: 1000,
        generationMs: 8000,
        wallMs: 10000,
        inputTokens: 100,
        outputTokens: 400,
        totalTokens: 500,
        tpsGeneration: 50,
        tpsWall: 40,
        status: 'completed',
        ...overrides,
    };
}

describe('aggregateTurnPerformance', () => {
    it('returns an empty response for empty input', () => {
        const result = aggregateTurnPerformance([]);
        expect(result.groups).toEqual([]);
        expect(result.groupBy).toEqual(['provider']);
        expect(result.days).toBeNull();
        expect(result.totalEvents).toBe(0);
        expect(result.excludedEvents).toEqual({ nonCompleted: 0, noFirstToken: 0, noTokenUsage: 0 });
        expect(typeof result.generatedAt).toBe('string');
    });

    it('aggregates a single row into one group with n=1 distributions', () => {
        const result = aggregateTurnPerformance([makeEvent()], { days: 30 });
        expect(result.days).toBe(30);
        expect(result.totalEvents).toBe(1);
        expect(result.groups).toHaveLength(1);
        const group = result.groups[0];
        expect(group.key).toEqual({ provider: 'claude' });
        expect(group.turnCount).toBe(1);
        expect(group.outputTokens).toBe(400);
        expect(group.ttftMs).toEqual({ p50: 2000, p90: 2000, p99: 2000, mean: 2000, min: 2000, max: 2000, n: 1 });
        expect(group.tpsGeneration.n).toBe(1);
        expect(group.tpsWall.n).toBe(1);
    });

    it('computes nearest-rank percentiles against a hand-computed fixture', () => {
        // ttftMs values 100..1000: p50 = 500, p90 = 900, p99 = 1000, mean = 550.
        const events = Array.from({ length: 10 }, (_, i) => makeEvent({ ttftMs: (i + 1) * 100 }));
        const { groups } = aggregateTurnPerformance(events);
        expect(groups).toHaveLength(1);
        expect(groups[0].ttftMs).toEqual({
            p50: 500,
            p90: 900,
            p99: 1000,
            mean: 550,
            min: 100,
            max: 1000,
            n: 10,
        });
    });

    it('groups by each single dimension', () => {
        const events = [
            makeEvent({ provider: 'claude', model: 'm1', workspaceId: 'ws-a', kind: 'chat', turnIndex: 0, startedAt: '2026-08-19T00:00:00.000Z' }),
            makeEvent({ provider: 'copilot', model: 'm2', workspaceId: 'ws-b', kind: 'ralph', turnIndex: 3, startedAt: '2026-08-20T00:00:00.000Z' }),
        ];
        for (const dim of TURN_PERFORMANCE_GROUP_BY_VALUES) {
            const { groups, groupBy } = aggregateTurnPerformance(events, { groupBy: [dim] });
            expect(groupBy).toEqual([dim]);
            expect(groups).toHaveLength(2);
            for (const group of groups) {
                expect(Object.keys(group.key)).toEqual([dim]);
            }
        }
        const byDay = aggregateTurnPerformance(events, { groupBy: ['day'] });
        expect(byDay.groups.map((g) => g.key.day)).toEqual(['2026-08-19', '2026-08-20']);
        const byTurn = aggregateTurnPerformance(events, { groupBy: ['turnIndex'] });
        expect(byTurn.groups.map((g) => g.key.turnIndex)).toEqual([0, 3]);
    });

    it('produces composite keys for multi-dimension groupBy', () => {
        const events = [
            makeEvent({ provider: 'claude', model: 'm1' }),
            makeEvent({ provider: 'claude', model: 'm2' }),
            makeEvent({ provider: 'claude', model: 'm2' }),
        ];
        const { groups } = aggregateTurnPerformance(events, { groupBy: ['provider', 'model'] });
        expect(groups).toHaveLength(2);
        expect(groups[0].key).toEqual({ provider: 'claude', model: 'm1' });
        expect(groups[1].key).toEqual({ provider: 'claude', model: 'm2' });
        expect(groups[1].turnCount).toBe(2);
    });

    it('maps null dimension values to "unknown"', () => {
        const { groups } = aggregateTurnPerformance(
            [makeEvent({ provider: null })],
        );
        expect(groups[0].key).toEqual({ provider: 'unknown' });
    });

    it('accounts for every exclusion in excludedEvents', () => {
        const events = [
            makeEvent(),
            makeEvent({ status: 'errored', firstOutputAt: null, ttftMs: null, tpsGeneration: null, tpsWall: null }),
            makeEvent({ status: 'cancelled' }),
            // Completed but never produced output: excluded from TTFT only.
            makeEvent({ firstOutputAt: null, ttftMs: null, generationMs: null, tpsGeneration: null, tpsWall: null, outputTokens: 200 }),
            // Completed but provider reported no usage: excluded from TPS only.
            makeEvent({ outputTokens: null, totalTokens: null, inputTokens: null, tpsGeneration: null, tpsWall: null }),
        ];
        const result = aggregateTurnPerformance(events);
        expect(result.totalEvents).toBe(3);
        expect(result.excludedEvents).toEqual({ nonCompleted: 2, noFirstToken: 1, noTokenUsage: 1 });
        const group = result.groups[0];
        expect(group.turnCount).toBe(3);
        expect(group.ttftMs.n).toBe(2);
        expect(group.tpsGeneration.n).toBe(1);
        expect(group.tpsWall.n).toBe(1);
        // outputTokens sums only known values.
        expect(group.outputTokens).toBe(600);
    });
});

describe('isTurnPerformanceGroupBy', () => {
    it('accepts every allowlisted dimension and rejects others', () => {
        for (const dim of TURN_PERFORMANCE_GROUP_BY_VALUES) {
            expect(isTurnPerformanceGroupBy(dim)).toBe(true);
        }
        expect(isTurnPerformanceGroupBy('bogus')).toBe(false);
        expect(isTurnPerformanceGroupBy('')).toBe(false);
        expect(isTurnPerformanceGroupBy('provider; DROP TABLE')).toBe(false);
    });
});
