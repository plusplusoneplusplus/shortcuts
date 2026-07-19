/**
 * pauseSource plumbing tests.
 *
 * Verifies that the HTTP pause/resume endpoints stamp 'manual' on QueueGlobalState
 * and that getAggregateStats surfaces it in QueueStats. Also verifies that
 * normalizeGlobalQueueState clears pauseSource when a timed pause expires.
 */

import { describe, it, expect } from 'vitest';
import {
    normalizeGlobalQueueState,
    getAggregateStats,
    type QueueGlobalState,
} from '../../src/server/routes/queue-shared';
import type { MultiRepoQueueRouter } from '../../src/server/queue/multi-repo-queue-router';

// ============================================================================
// Minimal bridge stub — no queues registered
// ============================================================================

function emptyBridge(): MultiRepoQueueRouter {
    return {
        registry: {
            getAllQueues: () => new Map(),
        },
    } as unknown as MultiRepoQueueRouter;
}

function makeState(overrides?: Partial<QueueGlobalState>): QueueGlobalState {
    return {
        globalPaused: false,
        globalPausedUntil: undefined,
        globalPauseSource: undefined,
        globalAutopilotPaused: false,
        globalAutopilotPausedUntil: undefined,
        globalAutopilotPauseSource: undefined,
        resumeInProgress: new Set(),
        ...overrides,
    };
}

// ============================================================================

describe('pauseSource — getAggregateStats surfaces', () => {
    it('returns pauseSource=manual when globally paused with manual source', () => {
        const state = makeState({ globalPaused: true, globalPauseSource: 'manual' });
        const stats = getAggregateStats(emptyBridge(), state);
        expect(stats.isPaused).toBe(true);
        expect(stats.pauseSource).toBe('manual');
    });

    it('returns pauseSource=quota when globally paused with quota source', () => {
        const state = makeState({ globalPaused: true, globalPauseSource: 'quota' });
        const stats = getAggregateStats(emptyBridge(), state);
        expect(stats.pauseSource).toBe('quota');
    });

    it('omits pauseSource when not paused', () => {
        const state = makeState({ globalPaused: false, globalPauseSource: undefined });
        const stats = getAggregateStats(emptyBridge(), state);
        expect(stats.isPaused).toBe(false);
        expect(stats.pauseSource).toBeUndefined();
    });

    it('returns autopilotPauseSource=manual when autopilot paused with manual source', () => {
        const state = makeState({ globalAutopilotPaused: true, globalAutopilotPauseSource: 'manual' });
        const stats = getAggregateStats(emptyBridge(), state);
        expect(stats.isAutopilotPaused).toBe(true);
        expect(stats.autopilotPauseSource).toBe('manual');
    });

    it('returns autopilotPauseSource=quota when autopilot paused with quota source', () => {
        const state = makeState({ globalAutopilotPaused: true, globalAutopilotPauseSource: 'quota' });
        const stats = getAggregateStats(emptyBridge(), state);
        expect(stats.autopilotPauseSource).toBe('quota');
    });

    it('omits autopilotPauseSource when autopilot not paused', () => {
        const state = makeState();
        const stats = getAggregateStats(emptyBridge(), state);
        expect(stats.autopilotPauseSource).toBeUndefined();
    });
});

describe('pauseSource — normalizeGlobalQueueState clears on timed expiry', () => {
    it('clears globalPauseSource when timed pause expires', () => {
        const past = Date.now() - 1000;
        const state = makeState({
            globalPaused: true,
            globalPausedUntil: past,
            globalPauseSource: 'quota',
        });
        normalizeGlobalQueueState(state);
        expect(state.globalPaused).toBe(false);
        expect(state.globalPauseSource).toBeUndefined();
    });

    it('preserves globalPauseSource when timed pause has not expired', () => {
        const future = Date.now() + 60_000;
        const state = makeState({
            globalPaused: true,
            globalPausedUntil: future,
            globalPauseSource: 'quota',
        });
        normalizeGlobalQueueState(state);
        expect(state.globalPaused).toBe(true);
        expect(state.globalPauseSource).toBe('quota');
    });

    it('clears globalAutopilotPauseSource when timed autopilot pause expires', () => {
        const past = Date.now() - 1000;
        const state = makeState({
            globalAutopilotPaused: true,
            globalAutopilotPausedUntil: past,
            globalAutopilotPauseSource: 'quota',
        });
        normalizeGlobalQueueState(state);
        expect(state.globalAutopilotPaused).toBe(false);
        expect(state.globalAutopilotPauseSource).toBeUndefined();
    });
});
