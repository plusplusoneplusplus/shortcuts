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
        repoQueueMap: {},
        streamingChatWorkspaces: {},
        showDialog: false,
        dialogInitialFolderPath: null,
        dialogInitialWorkspaceId: null,
        dialogMode: 'task' as const,
        showHistory: false,
        isFollowUpStreaming: false,
        currentStreamingTurnIndex: null,
        draining: false,
        drainQueued: 0,
        drainRunning: 0,
        selectedTaskId: null,
        selectedTaskIdByRepo: {},
        refreshVersion: 0,
        queueInitialized: false,
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

        it('sets queueInitialized to true', () => {
            const state = makeState({ queueInitialized: false });
            const result = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: {
                    queued: [],
                    running: [],
                    stats: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false, isDraining: false },
                },
            });
            expect(result.queueInitialized).toBe(true);
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

    // ── REPO_QUEUE_STATS_UPDATED ───────────────────────────────────
    describe('REPO_QUEUE_STATS_UPDATED', () => {
        it('updates only stats for an existing repo queue entry', () => {
            const state = makeState({
                repoQueueMap: {
                    'ws-1': {
                        queued: [{ id: 'q1' }],
                        running: [{ id: 'r1' }],
                        history: [{ id: 'h1' }],
                        stats: {
                            queued: 1,
                            running: 1,
                            completed: 2,
                            failed: 0,
                            cancelled: 0,
                            total: 4,
                            isPaused: false,
                            isDraining: false,
                        },
                    },
                },
            });

            const result = queueReducer(state, {
                type: 'REPO_QUEUE_STATS_UPDATED',
                repoId: 'ws-1',
                stats: {
                    queued: 3,
                    running: 2,
                    isPaused: true,
                },
            });

            expect(result.repoQueueMap['ws-1'].queued).toEqual([{ id: 'q1' }]);
            expect(result.repoQueueMap['ws-1'].running).toEqual([{ id: 'r1' }]);
            expect(result.repoQueueMap['ws-1'].history).toEqual([{ id: 'h1' }]);
            expect(result.repoQueueMap['ws-1'].stats.queued).toBe(3);
            expect(result.repoQueueMap['ws-1'].stats.running).toBe(2);
            expect(result.repoQueueMap['ws-1'].stats.isPaused).toBe(true);
            expect(result.repoQueueMap['ws-1'].stats.completed).toBe(2);
        });

        it('creates a repo entry when only stats are known', () => {
            const state = makeState();

            const result = queueReducer(state, {
                type: 'REPO_QUEUE_STATS_UPDATED',
                repoId: 'ws-2',
                stats: {
                    queued: 4,
                    running: 1,
                    isPaused: false,
                },
            });

            expect(result.repoQueueMap['ws-2']).toBeDefined();
            expect(result.repoQueueMap['ws-2'].queued).toEqual([]);
            expect(result.repoQueueMap['ws-2'].running).toEqual([]);
            expect(result.repoQueueMap['ws-2'].history).toEqual([]);
            expect(result.repoQueueMap['ws-2'].stats.queued).toBe(4);
            expect(result.repoQueueMap['ws-2'].stats.running).toBe(1);
        });
    });

    describe('REPO_QUEUE_UPDATED', () => {
        it('does not clear task arrays when payload only updates stats', () => {
            const state = makeState({
                repoQueueMap: {
                    'ws-keep': {
                        queued: [{ id: 'q-keep' }],
                        running: [{ id: 'r-keep' }],
                        history: [{ id: 'h-keep' }],
                        stats: { queued: 1, running: 1, completed: 0, failed: 0, cancelled: 0, total: 2, isPaused: false, isDraining: false },
                    },
                },
            });

            const result = queueReducer(state, {
                type: 'REPO_QUEUE_UPDATED',
                repoId: 'ws-keep',
                queue: {
                    stats: { queued: 5, running: 0, completed: 0, failed: 0, cancelled: 0, total: 5, isPaused: true, isDraining: false },
                },
            });

            expect(result.repoQueueMap['ws-keep'].queued).toEqual([{ id: 'q-keep' }]);
            expect(result.repoQueueMap['ws-keep'].running).toEqual([{ id: 'r-keep' }]);
            expect(result.repoQueueMap['ws-keep'].history).toEqual([{ id: 'h-keep' }]);
            expect(result.repoQueueMap['ws-keep'].stats.queued).toBe(5);
            expect(result.repoQueueMap['ws-keep'].stats.isPaused).toBe(true);
        });
    });

    // ── SEED_QUEUE ─────────────────────────────────────────────────
    describe('SEED_QUEUE', () => {
        it('populates state when queueInitialized is false', () => {
            const state = makeState({ queueInitialized: false });
            const result = queueReducer(state, {
                type: 'SEED_QUEUE',
                queue: {
                    queued: [{ id: 'q1' }],
                    running: [{ id: 'r1' }],
                },
            });
            expect(result.queued).toHaveLength(1);
            expect(result.running).toHaveLength(1);
        });

        it('merges stats when provided', () => {
            const state = makeState({ queueInitialized: false });
            const result = queueReducer(state, {
                type: 'SEED_QUEUE',
                queue: {
                    queued: [],
                    running: [],
                    stats: { queued: 2, running: 1, completed: 5, failed: 0, cancelled: 0, total: 8, isPaused: false, isDraining: false },
                },
            });
            expect(result.stats.queued).toBe(2);
            expect(result.stats.completed).toBe(5);
        });

        it('keeps existing stats when stats not provided', () => {
            const existingStats = { queued: 3, running: 1, completed: 10, failed: 2, cancelled: 0, total: 16, isPaused: false, isDraining: false };
            const state = makeState({ queueInitialized: false, stats: existingStats });
            const result = queueReducer(state, {
                type: 'SEED_QUEUE',
                queue: { queued: [{ id: 'q1' }], running: [] },
            });
            expect(result.stats).toEqual(existingStats);
        });

        it('is a no-op after QUEUE_UPDATED has been received', () => {
            const state = makeState({ queueInitialized: true, queued: [{ id: 'ws1' }], running: [] });
            const result = queueReducer(state, {
                type: 'SEED_QUEUE',
                queue: {
                    queued: [{ id: 'rest1' }, { id: 'rest2' }],
                    running: [{ id: 'rest3' }],
                },
            });
            expect(result).toBe(state);
            expect(result.queued).toHaveLength(1);
            expect(result.queued[0].id).toBe('ws1');
        });

        it('does not set queueInitialized to true', () => {
            const state = makeState({ queueInitialized: false });
            const result = queueReducer(state, {
                type: 'SEED_QUEUE',
                queue: { queued: [{ id: 'q1' }], running: [] },
            });
            expect(result.queueInitialized).toBe(false);
        });

        it('handles null/undefined arrays gracefully', () => {
            const state = makeState({ queueInitialized: false });
            const result = queueReducer(state, {
                type: 'SEED_QUEUE',
                queue: { queued: null as any, running: undefined as any },
            });
            expect(result.queued).toEqual([]);
            expect(result.running).toEqual([]);
        });

        it('does not affect history, showHistory, or other unrelated state', () => {
            const state = makeState({
                queueInitialized: false,
                history: [{ id: 'h1' }],
                showHistory: true,
                draining: true,
            });
            const result = queueReducer(state, {
                type: 'SEED_QUEUE',
                queue: { queued: [{ id: 'q1' }], running: [] },
            });
            expect(result.history).toEqual([{ id: 'h1' }]);
            expect(result.showHistory).toBe(true);
            expect(result.draining).toBe(true);
        });
    });

    // ── SEED_QUEUE / QUEUE_UPDATED interaction ────────────────────
    describe('SEED_QUEUE / QUEUE_UPDATED interaction', () => {
        it('QUEUE_UPDATED after SEED_QUEUE overwrites with fresh data', () => {
            let state = makeState({ queueInitialized: false });
            state = queueReducer(state, {
                type: 'SEED_QUEUE',
                queue: { queued: [{ id: 'seed1' }], running: [] },
            });
            expect(state.queued).toHaveLength(1);
            expect(state.queueInitialized).toBe(false);

            state = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: {
                    queued: [{ id: 'ws1' }, { id: 'ws2' }],
                    running: [{ id: 'ws3' }],
                    stats: { queued: 2, running: 1, completed: 0, failed: 0, cancelled: 0, total: 3, isPaused: false, isDraining: false },
                },
            });
            expect(state.queued).toHaveLength(2);
            expect(state.running).toHaveLength(1);
            expect(state.queueInitialized).toBe(true);
        });

        it('SEED_QUEUE after QUEUE_UPDATED is ignored', () => {
            let state = makeState({ queueInitialized: false });
            state = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: {
                    queued: [{ id: 'ws1' }],
                    running: [],
                    stats: { queued: 1, running: 0, completed: 0, failed: 0, cancelled: 0, total: 1, isPaused: false, isDraining: false },
                },
            });
            expect(state.queueInitialized).toBe(true);

            const stateAfterSeed = queueReducer(state, {
                type: 'SEED_QUEUE',
                queue: { queued: [{ id: 'stale1' }, { id: 'stale2' }], running: [] },
            });
            expect(stateAfterSeed).toBe(state);
        });

        it('empty queue seed followed by WS update shows correct data', () => {
            let state = makeState({ queueInitialized: false });
            state = queueReducer(state, {
                type: 'SEED_QUEUE',
                queue: { queued: [], running: [] },
            });
            expect(state.queued).toHaveLength(0);

            state = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: {
                    queued: [{ id: 'new1' }],
                    running: [],
                    stats: { queued: 1, running: 0, completed: 0, failed: 0, cancelled: 0, total: 1, isPaused: false, isDraining: false },
                },
            });
            expect(state.queued).toHaveLength(1);
            expect(state.queueInitialized).toBe(true);
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

    // ── OPEN_DIALOG ─────────────────────────────────────────────────
    describe('OPEN_DIALOG', () => {
        it('sets showDialog true and dialogInitialFolderPath', () => {
            const result = queueReducer(makeState(), { type: 'OPEN_DIALOG', folderPath: 'feature1' });
            expect(result.showDialog).toBe(true);
            expect(result.dialogInitialFolderPath).toBe('feature1');
        });

        it('sets dialogInitialFolderPath to null when folderPath is omitted', () => {
            const result = queueReducer(makeState(), { type: 'OPEN_DIALOG' });
            expect(result.showDialog).toBe(true);
            expect(result.dialogInitialFolderPath).toBeNull();
        });

        it('sets dialogInitialFolderPath to null when folderPath is null', () => {
            const result = queueReducer(makeState(), { type: 'OPEN_DIALOG', folderPath: null });
            expect(result.showDialog).toBe(true);
            expect(result.dialogInitialFolderPath).toBeNull();
        });

        it('sets dialogMode to ask when mode is ask', () => {
            const result = queueReducer(makeState(), { type: 'OPEN_DIALOG', workspaceId: 'ws1', mode: 'ask' });
            expect(result.showDialog).toBe(true);
            expect(result.dialogMode).toBe('ask');
        });

        it('defaults dialogMode to task when mode is omitted', () => {
            const result = queueReducer(makeState(), { type: 'OPEN_DIALOG', workspaceId: 'ws1' });
            expect(result.dialogMode).toBe('task');
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

        it('CLOSE_DIALOG sets showDialog false and resets dialogInitialFolderPath', () => {
            const state = makeState({ showDialog: true, dialogInitialFolderPath: 'feature1' });
            const result = queueReducer(state, { type: 'CLOSE_DIALOG' });
            expect(result.showDialog).toBe(false);
            expect(result.dialogInitialFolderPath).toBeNull();
        });

        it('CLOSE_DIALOG resets dialogMode to task', () => {
            const state = makeState({ showDialog: true, dialogMode: 'ask' });
            const result = queueReducer(state, { type: 'CLOSE_DIALOG' });
            expect(result.dialogMode).toBe('task');
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

    // ── REFRESH_SELECTED_QUEUE_TASK ────────────────────────────────
    describe('REFRESH_SELECTED_QUEUE_TASK', () => {
        it('increments refreshVersion from 0 to 1', () => {
            const result = queueReducer(makeState(), { type: 'REFRESH_SELECTED_QUEUE_TASK' });
            expect(result.refreshVersion).toBe(1);
        });

        it('increments refreshVersion on each dispatch', () => {
            let state = makeState();
            state = queueReducer(state, { type: 'REFRESH_SELECTED_QUEUE_TASK' });
            state = queueReducer(state, { type: 'REFRESH_SELECTED_QUEUE_TASK' });
            state = queueReducer(state, { type: 'REFRESH_SELECTED_QUEUE_TASK' });
            expect(state.refreshVersion).toBe(3);
        });

        it('does not change selectedTaskId or other state', () => {
            const state = makeState({ selectedTaskId: 'task-abc', refreshVersion: 5 });
            const result = queueReducer(state, { type: 'REFRESH_SELECTED_QUEUE_TASK' });
            expect(result.selectedTaskId).toBe('task-abc');
            expect(result.refreshVersion).toBe(6);
            expect(result.queued).toBe(state.queued);
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

    // ── CHAT_STREAMING_STARTED / CHAT_STREAMING_STOPPED ────────────
    describe('CHAT_STREAMING_STARTED', () => {
        it('increments count for a workspace', () => {
            const result = queueReducer(makeState(), {
                type: 'CHAT_STREAMING_STARTED',
                workspaceId: 'ws-1',
            });
            expect(result.streamingChatWorkspaces['ws-1']).toBe(1);
        });

        it('increments count for multiple starts on the same workspace', () => {
            let state = makeState();
            state = queueReducer(state, { type: 'CHAT_STREAMING_STARTED', workspaceId: 'ws-1' });
            state = queueReducer(state, { type: 'CHAT_STREAMING_STARTED', workspaceId: 'ws-1' });
            expect(state.streamingChatWorkspaces['ws-1']).toBe(2);
        });

        it('tracks multiple workspaces independently', () => {
            let state = makeState();
            state = queueReducer(state, { type: 'CHAT_STREAMING_STARTED', workspaceId: 'ws-1' });
            state = queueReducer(state, { type: 'CHAT_STREAMING_STARTED', workspaceId: 'ws-2' });
            expect(state.streamingChatWorkspaces['ws-1']).toBe(1);
            expect(state.streamingChatWorkspaces['ws-2']).toBe(1);
        });
    });

    describe('CHAT_STREAMING_STOPPED', () => {
        it('decrements count for a workspace', () => {
            const state = makeState({ streamingChatWorkspaces: { 'ws-1': 2 } });
            const result = queueReducer(state, { type: 'CHAT_STREAMING_STOPPED', workspaceId: 'ws-1' });
            expect(result.streamingChatWorkspaces['ws-1']).toBe(1);
        });

        it('removes workspace key when count reaches zero', () => {
            const state = makeState({ streamingChatWorkspaces: { 'ws-1': 1 } });
            const result = queueReducer(state, { type: 'CHAT_STREAMING_STOPPED', workspaceId: 'ws-1' });
            expect(result.streamingChatWorkspaces['ws-1']).toBeUndefined();
        });

        it('does not go negative for unknown workspace', () => {
            const state = makeState();
            const result = queueReducer(state, { type: 'CHAT_STREAMING_STOPPED', workspaceId: 'ws-unknown' });
            expect(result.streamingChatWorkspaces['ws-unknown']).toBeUndefined();
        });

        it('does not affect other workspaces', () => {
            const state = makeState({ streamingChatWorkspaces: { 'ws-1': 1, 'ws-2': 3 } });
            const result = queueReducer(state, { type: 'CHAT_STREAMING_STOPPED', workspaceId: 'ws-1' });
            expect(result.streamingChatWorkspaces['ws-1']).toBeUndefined();
            expect(result.streamingChatWorkspaces['ws-2']).toBe(3);
        });
    });
});
