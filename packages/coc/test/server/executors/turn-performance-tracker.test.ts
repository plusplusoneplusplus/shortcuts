/**
 * Turn Performance Tracker Tests
 *
 * Covers the pure TTFT/TPS derivation (normal turn, no-output turn,
 * zero-duration guard, missing token usage, errored turn) and the tracker
 * lifecycle, including the AC-01 contract that `appendOutputChunk` stamps
 * `firstOutputAt` exactly once across many chunks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TokenUsage } from '@plusplusoneplusplus/forge';
import {
    TurnPerformanceTracker,
    deriveTurnPerformanceEvent,
    type InFlightTurnTiming,
    type TurnSettlementContext,
} from '../../../src/server/executors/turn-performance-tracker';
import { BaseExecutor } from '../../../src/server/executors/base-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Fixtures
// ============================================================================

const T0 = Date.parse('2026-08-20T10:00:00.000Z');

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
    return {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 1500,
        turnCount: 1,
        ...overrides,
    };
}

function context(overrides: Partial<TurnSettlementContext> = {}): TurnSettlementContext {
    return { turnIndex: 0, status: 'completed', ...overrides };
}

// ============================================================================
// deriveTurnPerformanceEvent — pure derivation
// ============================================================================

describe('deriveTurnPerformanceEvent', () => {
    it('derives a normal turn: ttft, queue wait, generation/wall tps', () => {
        const timing: InFlightTurnTiming = {
            enqueuedAt: T0,
            startedAt: T0 + 2_000,
            firstOutputAt: T0 + 5_000,
        };
        const event = deriveTurnPerformanceEvent('proc-1', timing, context({
            turnIndex: 3,
            workspaceId: 'ws-1',
            provider: 'claude',
            model: 'claude-sonnet-5',
            effortTier: 'medium',
            mode: 'autopilot',
            kind: 'chat',
            tokenUsage: usage({ outputTokens: 500 }),
        }), T0 + 15_000);

        expect(event.id).toBe('proc-1:3');
        expect(event.processId).toBe('proc-1');
        expect(event.turnIndex).toBe(3);
        expect(event.workspaceId).toBe('ws-1');
        expect(event.provider).toBe('claude');
        expect(event.model).toBe('claude-sonnet-5');
        expect(event.effortTier).toBe('medium');
        expect(event.mode).toBe('autopilot');
        expect(event.kind).toBe('chat');
        expect(event.enqueuedAt).toBe('2026-08-20T10:00:00.000Z');
        expect(event.startedAt).toBe('2026-08-20T10:00:02.000Z');
        expect(event.firstOutputAt).toBe('2026-08-20T10:00:05.000Z');
        expect(event.endedAt).toBe('2026-08-20T10:00:15.000Z');
        expect(event.queueWaitMs).toBe(2_000);
        expect(event.ttftMs).toBe(3_000);
        expect(event.generationMs).toBe(10_000);
        expect(event.wallMs).toBe(13_000);
        expect(event.inputTokens).toBe(1000);
        expect(event.outputTokens).toBe(500);
        expect(event.totalTokens).toBe(1500);
        // 500 tokens / 10s generation, 500 / 13s wall
        expect(event.tpsGeneration).toBe(50);
        expect(event.tpsWall).toBe(38.462);
        expect(event.status).toBe('completed');
    });

    it('no-output turn: firstOutputAt/ttftMs/generationMs/tps* are null, wallMs present', () => {
        const timing: InFlightTurnTiming = { startedAt: T0 };
        const event = deriveTurnPerformanceEvent('proc-1', timing, context({
            tokenUsage: usage(),
        }), T0 + 4_000);

        expect(event.firstOutputAt).toBeNull();
        expect(event.ttftMs).toBeNull();
        expect(event.generationMs).toBeNull();
        expect(event.tpsGeneration).toBeNull();
        // wall tps still computable from reported tokens
        expect(event.tpsWall).toBe(125);
        expect(event.wallMs).toBe(4_000);
        expect(event.queueWaitMs).toBeNull();
        expect(event.enqueuedAt).toBeNull();
    });

    it('zero-duration guard: never divides by zero, tps fields are null (not Infinity/NaN)', () => {
        const timing: InFlightTurnTiming = { startedAt: T0, firstOutputAt: T0 };
        const event = deriveTurnPerformanceEvent('proc-1', timing, context({
            tokenUsage: usage(),
        }), T0);

        expect(event.wallMs).toBe(0);
        expect(event.ttftMs).toBe(0);
        expect(event.generationMs).toBe(0);
        expect(event.tpsGeneration).toBeNull();
        expect(event.tpsWall).toBeNull();
    });

    it('missing token usage: token fields and tps* are SQL-null, never zero', () => {
        const timing: InFlightTurnTiming = { startedAt: T0, firstOutputAt: T0 + 1_000 };
        const event = deriveTurnPerformanceEvent('proc-1', timing, context(), T0 + 2_000);

        expect(event.inputTokens).toBeNull();
        expect(event.outputTokens).toBeNull();
        expect(event.totalTokens).toBeNull();
        expect(event.tpsGeneration).toBeNull();
        expect(event.tpsWall).toBeNull();
        // timing metrics still recorded
        expect(event.ttftMs).toBe(1_000);
        expect(event.wallMs).toBe(2_000);
    });

    it('errored turn without output is still recorded with status errored', () => {
        const timing: InFlightTurnTiming = { enqueuedAt: T0, startedAt: T0 + 500 };
        const event = deriveTurnPerformanceEvent('proc-1', timing, context({
            status: 'errored',
        }), T0 + 30_500);

        expect(event.status).toBe('errored');
        expect(event.firstOutputAt).toBeNull();
        expect(event.ttftMs).toBeNull();
        expect(event.wallMs).toBe(30_000);
        expect(event.queueWaitMs).toBe(500);
    });

    it('reported zero output tokens is data, not missing: tps is 0, not null', () => {
        const timing: InFlightTurnTiming = { startedAt: T0, firstOutputAt: T0 + 1_000 };
        const event = deriveTurnPerformanceEvent('proc-1', timing, context({
            tokenUsage: usage({ outputTokens: 0, totalTokens: 1000 }),
        }), T0 + 2_000);

        expect(event.outputTokens).toBe(0);
        expect(event.tpsGeneration).toBe(0);
        expect(event.tpsWall).toBe(0);
    });

    it('clamps negative clock skew to zero rather than storing negative durations', () => {
        const timing: InFlightTurnTiming = {
            enqueuedAt: T0 + 1_000,
            startedAt: T0,
            firstOutputAt: T0 + 100,
        };
        const event = deriveTurnPerformanceEvent('proc-1', timing, context(), T0 + 50);

        expect(event.queueWaitMs).toBe(0);
        expect(event.wallMs).toBe(50);
        expect(event.generationMs).toBe(0);
    });
});

// ============================================================================
// TurnPerformanceTracker — lifecycle
// ============================================================================

describe('TurnPerformanceTracker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('begin → markFirstOutput → settle produces a complete event and clears state', () => {
        const tracker = new TurnPerformanceTracker();
        tracker.begin('proc-1', { enqueuedAt: T0 - 1_000 });

        vi.setSystemTime(T0 + 3_000);
        tracker.markFirstOutput('proc-1');

        vi.setSystemTime(T0 + 10_000);
        const event = tracker.settle('proc-1', context({ turnIndex: 2, tokenUsage: usage() }));

        expect(event).toBeDefined();
        expect(event!.id).toBe('proc-1:2');
        expect(event!.queueWaitMs).toBe(1_000);
        expect(event!.ttftMs).toBe(3_000);
        expect(event!.wallMs).toBe(10_000);
        expect(tracker.hasInFlight('proc-1')).toBe(false);
        // second settle for the same process yields nothing
        expect(tracker.settle('proc-1', context())).toBeUndefined();
    });

    it('markFirstOutput stamps exactly once across many chunks', () => {
        const tracker = new TurnPerformanceTracker();
        tracker.begin('proc-1');

        vi.setSystemTime(T0 + 1_000);
        tracker.markFirstOutput('proc-1');
        const first = tracker.getInFlight('proc-1')!.firstOutputAt;

        for (let i = 0; i < 100; i++) {
            vi.setSystemTime(T0 + 2_000 + i);
            tracker.markFirstOutput('proc-1');
        }
        expect(tracker.getInFlight('proc-1')!.firstOutputAt).toBe(first);
        expect(first).toBe(T0 + 1_000);
    });

    it('markFirstOutput/settle without begin are safe no-ops (resumed mid-turn: no bogus row)', () => {
        const tracker = new TurnPerformanceTracker();
        tracker.markFirstOutput('unknown-proc');
        expect(tracker.hasInFlight('unknown-proc')).toBe(false);
        expect(tracker.settle('unknown-proc', context())).toBeUndefined();
    });

    it('abandon drops state without producing an event', () => {
        const tracker = new TurnPerformanceTracker();
        tracker.begin('proc-1');
        tracker.abandon('proc-1');
        expect(tracker.settle('proc-1', context())).toBeUndefined();
    });

    it('timing state is per-process: concurrent turns do not bleed into each other', () => {
        const tracker = new TurnPerformanceTracker();
        tracker.begin('proc-a');
        vi.setSystemTime(T0 + 1_000);
        tracker.begin('proc-b');

        vi.setSystemTime(T0 + 2_000);
        tracker.markFirstOutput('proc-a');
        vi.setSystemTime(T0 + 5_000);
        tracker.markFirstOutput('proc-b');

        vi.setSystemTime(T0 + 6_000);
        const a = tracker.settle('proc-a', context({ turnIndex: 0 }));
        const b = tracker.settle('proc-b', context({ turnIndex: 0 }));

        expect(a!.ttftMs).toBe(2_000);
        expect(b!.ttftMs).toBe(4_000);
        expect(a!.processId).toBe('proc-a');
        expect(b!.processId).toBe('proc-b');
    });

    it('begin overwrites a stale entry so a retried turn restarts timing cleanly', () => {
        const tracker = new TurnPerformanceTracker();
        tracker.begin('proc-1');
        vi.setSystemTime(T0 + 1_000);
        tracker.markFirstOutput('proc-1');

        vi.setSystemTime(T0 + 2_000);
        tracker.begin('proc-1'); // retry
        expect(tracker.getInFlight('proc-1')!.firstOutputAt).toBeUndefined();
        expect(tracker.getInFlight('proc-1')!.startedAt).toBe(T0 + 2_000);
    });
});

// ============================================================================
// BaseExecutor.appendOutputChunk integration
// ============================================================================

/** Minimal concrete executor exposing the protected members under test. */
class TimingTestExecutor extends BaseExecutor {
    public appendOutputChunkPublic(processId: string, chunk: string): void {
        this.appendOutputChunk(processId, chunk);
    }
    public get turnPerformancePublic(): TurnPerformanceTracker {
        return this.turnPerformance;
    }
    public getOutputBufferPublic(processId: string): string {
        return this.getOutputBuffer(processId);
    }
}

describe('BaseExecutor.appendOutputChunk first-output stamp', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('stamps firstOutputAt exactly once across many chunks and still buffers output', () => {
        const executor = new TimingTestExecutor(createMockProcessStore());
        executor.turnPerformancePublic.begin('proc-1');

        vi.setSystemTime(T0 + 750);
        executor.appendOutputChunkPublic('proc-1', 'first ');
        for (let i = 0; i < 200; i++) {
            vi.setSystemTime(T0 + 1_000 + i * 10);
            executor.appendOutputChunkPublic('proc-1', 'x');
        }

        const timing = executor.turnPerformancePublic.getInFlight('proc-1');
        expect(timing!.firstOutputAt).toBe(T0 + 750);
        expect(executor.getOutputBufferPublic('proc-1')).toBe('first ' + 'x'.repeat(200));
    });

    it('chunks arriving with no turn in flight do not fabricate timing state', () => {
        const executor = new TimingTestExecutor(createMockProcessStore());
        executor.appendOutputChunkPublic('proc-1', 'chunk');
        expect(executor.turnPerformancePublic.hasInFlight('proc-1')).toBe(false);
        expect(executor.getOutputBufferPublic('proc-1')).toBe('chunk');
    });
});
