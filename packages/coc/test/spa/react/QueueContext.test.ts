/**
 * Tests for QueueContext reducer — queue updates, drain lifecycle, dialog/history toggles.
 */

import { describe, it, expect } from 'vitest';
import { queueReducer, type QueueContextState, type QueueAction } from '../../../src/server/spa/client/react/context/QueueContext';

function makeState(overrides: Partial<QueueContextState> = {}): QueueContextState {
    return {
        queued: [],
        running: [],
        history: [],
        stats: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false, isDraining: false },
        showDialog: false,
        showHistory: false,
        isFollowUpStreaming: false,
        currentStreamingTurnIndex: null,
        draining: false,
        drainQueued: 0,
        drainRunning: 0,
        selectedTaskId: null,
        ...overrides,
    };
}

describe('QueueContext reducer', () => {
    // ── QUEUE_UPDATED ──────────────────────────────────────────────
    describe('QUEUE_UPDATED', () => {
        it('updates queued, running, and stats', () => {
            const state = makeState();
            const result = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: {
                    queued: [{ id: 'q1' }],
                    running: [{ id: 'r1' }],
                    stats: { queued: 1, running: 1, completed: 0, failed: 0, cancelled: 0, total: 2, isPaused: false, isDraining: false },
                },
            });
            expect(result.queued).toHaveLength(1);
            expect(result.running).toHaveLength(1);
            expect(result.stats.queued).toBe(1);
        });

        it('sets history when present in queue data', () => {
            const state = makeState();
            const result = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: {
                    queued: [],
                    running: [],
                    history: [{ id: 'h1' }],
                    stats: { queued: 0, running: 0, completed: 1, failed: 0, cancelled: 0, total: 1, isPaused: false, isDraining: false },
                },
            });
            expect(result.history).toHaveLength(1);
        });

        it('keeps existing history when not present in queue data', () => {
            const state = makeState({ history: [{ id: 'h1' }] });
            const result = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: {
                    queued: [],
                    running: [],
                    stats: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false, isDraining: false },
                },
            });
            expect(result.history).toHaveLength(1);
        });

        it('auto-shows history when completed count increases', () => {
            const state = makeState({
                stats: { queued: 0, running: 0, completed: 2, failed: 0, cancelled: 0, total: 2, isPaused: false, isDraining: false },
                showHistory: false,
            });
            const result = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: {
                    queued: [],
                    running: [],
                    stats: { queued: 0, running: 0, completed: 3, failed: 0, cancelled: 0, total: 3, isPaused: false, isDraining: false },
                },
            });
            expect(result.showHistory).toBe(true);
        });

        it('auto-shows history when failed count increases', () => {
            const state = makeState({
                stats: { queued: 0, running: 0, completed: 0, failed: 1, cancelled: 0, total: 1, isPaused: false, isDraining: false },
                showHistory: false,
            });
            const result = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: {
                    queued: [],
                    running: [],
                    stats: { queued: 0, running: 0, completed: 0, failed: 2, cancelled: 0, total: 2, isPaused: false, isDraining: false },
                },
            });
            expect(result.showHistory).toBe(true);
        });

        it('does not change showHistory when counts stay the same', () => {
            const state = makeState({
                stats: { queued: 0, running: 0, completed: 1, failed: 0, cancelled: 0, total: 1, isPaused: false, isDraining: false },
                showHistory: false,
            });
            const result = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: {
                    queued: [],
                    running: [],
                    stats: { queued: 0, running: 0, completed: 1, failed: 0, cancelled: 0, total: 1, isPaused: false, isDraining: false },
                },
            });
            expect(result.showHistory).toBe(false);
        });
    });

    // ── Drain lifecycle ────────────────────────────────────────────
    describe('drain lifecycle', () => {
        it('DRAIN_START sets draining with counts', () => {
            const result = queueReducer(makeState(), { type: 'DRAIN_START', queued: 3, running: 2 });
            expect(result.draining).toBe(true);
            expect(result.drainQueued).toBe(3);
            expect(result.drainRunning).toBe(2);
        });

        it('DRAIN_PROGRESS updates counts', () => {
            const state = makeState({ draining: true, drainQueued: 3, drainRunning: 2 });
            const result = queueReducer(state, { type: 'DRAIN_PROGRESS', queued: 1, running: 1 });
            expect(result.drainQueued).toBe(1);
            expect(result.drainRunning).toBe(1);
        });

        it('DRAIN_COMPLETE resets draining', () => {
            const state = makeState({ draining: true, drainQueued: 1, drainRunning: 1 });
            const result = queueReducer(state, { type: 'DRAIN_COMPLETE' });
            expect(result.draining).toBe(false);
            expect(result.drainQueued).toBe(0);
            expect(result.drainRunning).toBe(0);
        });

        it('DRAIN_TIMEOUT resets draining', () => {
            const state = makeState({ draining: true, drainQueued: 1, drainRunning: 1 });
            const result = queueReducer(state, { type: 'DRAIN_TIMEOUT' });
            expect(result.draining).toBe(false);
        });
    });

    // ── Dialog and history toggles ─────────────────────────────────
    describe('dialog and history toggles', () => {
        it('TOGGLE_DIALOG toggles showDialog', () => {
            const result = queueReducer(makeState(), { type: 'TOGGLE_DIALOG' });
            expect(result.showDialog).toBe(true);
            const result2 = queueReducer(result, { type: 'TOGGLE_DIALOG' });
            expect(result2.showDialog).toBe(false);
        });

        it('CLOSE_DIALOG sets showDialog false', () => {
            const state = makeState({ showDialog: true });
            const result = queueReducer(state, { type: 'CLOSE_DIALOG' });
            expect(result.showDialog).toBe(false);
        });

        it('TOGGLE_HISTORY toggles showHistory', () => {
            const result = queueReducer(makeState(), { type: 'TOGGLE_HISTORY' });
            expect(result.showHistory).toBe(true);
        });
    });

    // ── SELECT_QUEUE_TASK ──────────────────────────────────────────
    describe('SELECT_QUEUE_TASK', () => {
        it('sets selectedTaskId', () => {
            const result = queueReducer(makeState(), { type: 'SELECT_QUEUE_TASK', id: 'task-1' });
            expect(result.selectedTaskId).toBe('task-1');
        });

        it('clears selectedTaskId with null', () => {
            const state = makeState({ selectedTaskId: 'task-1' });
            const result = queueReducer(state, { type: 'SELECT_QUEUE_TASK', id: null });
            expect(result.selectedTaskId).toBeNull();
        });
    });

    // ── SET_FOLLOW_UP_STREAMING ────────────────────────────────────
    describe('SET_FOLLOW_UP_STREAMING', () => {
        it('sets streaming state and turn index', () => {
            const result = queueReducer(makeState(), {
                type: 'SET_FOLLOW_UP_STREAMING',
                value: true,
                turnIndex: 3,
            });
            expect(result.isFollowUpStreaming).toBe(true);
            expect(result.currentStreamingTurnIndex).toBe(3);
        });
    });
});
