/**
 * Tests for QueueContext reducer — queue updates, drain lifecycle, dialog/history toggles.
 */

import { describe, it, expect } from 'vitest';
import { queueReducer, type QueueContextState, type QueueAction } from '../../../src/server/spa/client/react/contexts/QueueContext';

function makeState(overrides: Partial<QueueContextState> = {}): QueueContextState {
    return {
        queued: [],
        running: [],
        history: [],
        stats: { queued: 0, running: 0, total: 0, isPaused: false, isDraining: false },
        repoQueueMap: {},
        streamingChatWorkspaces: {},
        showDialog: false,
        dialogInitialFolderPath: null,
        dialogInitialWorkspaceId: null,
        dialogInitialPrompt: null,
        dialogAttachedContext: null,
        dialogMode: 'task' as const,
        dialogLaunchMode: 'default' as const,
        dialogContextFiles: null,
        dialogContextTaskName: null,
        dialogBulkMode: false,
        dialogResolveContext: null,
        showScriptDialog: false,
        scriptDialogWorkspaceId: null,
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
        isTaskSubmitting: false,
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
                    stats: { queued: 1, running: 1, total: 2, isPaused: false, isDraining: false },
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
                    stats: { queued: 0, running: 0, total: 0, isPaused: false, isDraining: false },
                },
            });
            expect(result.queueInitialized).toBe(true);
        });

        it('preserves history items not present in running or queued', () => {
            const state = makeState({ history: [{ id: 'h1' }] });
            const result = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: {
                    queued: [],
                    running: [],
                    stats: { queued: 0, running: 0, total: 0, isPaused: false, isDraining: false },
                },
            });
            expect(result.history).toEqual([{ id: 'h1' }]);
        });

        it('evicts history items that appear in running (follow-up re-queue)', () => {
            const state = makeState({ history: [{ id: 'h1' }, { id: 'h2' }] });
            const result = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: {
                    queued: [],
                    running: [{ id: 'h1' }],
                    stats: { queued: 0, running: 1, total: 1, isPaused: false, isDraining: false },
                },
            });
            expect(result.history).toEqual([{ id: 'h2' }]);
        });

        it('evicts history items that appear in queued', () => {
            const state = makeState({ history: [{ id: 'h1' }, { id: 'h2' }] });
            const result = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: {
                    queued: [{ id: 'h2' }],
                    running: [],
                    stats: { queued: 1, running: 0, total: 1, isPaused: false, isDraining: false },
                },
            });
            expect(result.history).toEqual([{ id: 'h1' }]);
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
                        stats: {
                            queued: 1,
                            running: 1,
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
            expect(result.repoQueueMap['ws-1'].stats.queued).toBe(3);
            expect(result.repoQueueMap['ws-1'].stats.running).toBe(2);
            expect(result.repoQueueMap['ws-1'].stats.isPaused).toBe(true);
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
                        stats: { queued: 1, running: 1, total: 2, isPaused: false, isDraining: false },
                    },
                },
            });

            const result = queueReducer(state, {
                type: 'REPO_QUEUE_UPDATED',
                repoId: 'ws-keep',
                queue: {
                    stats: { queued: 5, running: 0, total: 5, isPaused: true, isDraining: false },
                },
            });

            expect(result.repoQueueMap['ws-keep'].queued).toEqual([{ id: 'q-keep' }]);
            expect(result.repoQueueMap['ws-keep'].running).toEqual([{ id: 'r-keep' }]);
            expect(result.repoQueueMap['ws-keep'].stats.queued).toBe(5);
            expect(result.repoQueueMap['ws-keep'].stats.isPaused).toBe(true);
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

        it('sets dialogLaunchMode when provided', () => {
            const result = queueReducer(makeState(), { type: 'OPEN_DIALOG', workspaceId: 'ws1', mode: 'ask', launchMode: 'floating-chat' });
            expect(result.dialogLaunchMode).toBe('floating-chat');
        });

        it('defaults dialogLaunchMode to default when not provided', () => {
            const result = queueReducer(makeState(), { type: 'OPEN_DIALOG', workspaceId: 'ws1' });
            expect(result.dialogLaunchMode).toBe('default');
        });

        it('sets contextFiles when provided', () => {
            const files = ['/path/to/a.md', '/path/to/b.md'];
            const result = queueReducer(makeState(), { type: 'OPEN_DIALOG', contextFiles: files, contextTaskName: 'feature' });
            expect(result.dialogContextFiles).toEqual(files);
            expect(result.dialogContextTaskName).toBe('feature');
        });

        it('defaults contextFiles to null when omitted', () => {
            const result = queueReducer(makeState(), { type: 'OPEN_DIALOG' });
            expect(result.dialogContextFiles).toBeNull();
            expect(result.dialogContextTaskName).toBeNull();
            expect(result.dialogBulkMode).toBe(false);
        });

        it('sets attached context when provided', () => {
            const attachedContext = [{
                kind: 'coc.work-item-context' as const,
                version: 1 as const,
                sourceWorkspaceId: 'ws1',
                workItemId: 'wi-123',
                workItemNumber: 123,
                label: 'Work Item #123',
                title: 'Investigate drag context',
            }];
            const result = queueReducer(makeState(), { type: 'OPEN_DIALOG', workspaceId: 'ws1', attachedContext });
            expect(result.dialogAttachedContext).toEqual(attachedContext);
        });

        it('sets bulkMode when provided', () => {
            const result = queueReducer(makeState(), {
                type: 'OPEN_DIALOG',
                contextFiles: ['/a.md', '/b.md'],
                bulkMode: true,
            });
            expect(result.dialogBulkMode).toBe(true);
        });

        it('sets dialogMode to resolve and stores resolveContext', () => {
            const onSubmit = () => {};
            const result = queueReducer(makeState(), {
                type: 'OPEN_DIALOG',
                workspaceId: 'ws1',
                mode: 'resolve',
                resolveContext: { title: 'Resolve with AI', commentCount: 3, onSubmit },
            });
            expect(result.showDialog).toBe(true);
            expect(result.dialogMode).toBe('resolve');
            expect(result.dialogResolveContext).toEqual({ title: 'Resolve with AI', commentCount: 3, onSubmit });
        });

        it('defaults dialogResolveContext to null when not provided', () => {
            const result = queueReducer(makeState(), { type: 'OPEN_DIALOG', workspaceId: 'ws1' });
            expect(result.dialogResolveContext).toBeNull();
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

        it('CLOSE_DIALOG resets dialogLaunchMode to default', () => {
            const state = makeState({ showDialog: true, dialogLaunchMode: 'floating-chat' });
            const result = queueReducer(state, { type: 'CLOSE_DIALOG' });
            expect(result.dialogLaunchMode).toBe('default');
        });

        it('CLOSE_DIALOG resets context fields', () => {
            const state = makeState({
                showDialog: true,
                dialogContextFiles: ['/a.md'],
                dialogContextTaskName: 'feature',
                dialogBulkMode: true,
                dialogAttachedContext: [{
                    kind: 'coc.git-commit-context',
                    version: 1,
                    sourceWorkspaceId: 'ws1',
                    commitHash: 'abcdef1234567890',
                    shortHash: 'abcdef1',
                    label: 'Commit abcdef1',
                }],
                dialogResolveContext: { title: 'Resolve', commentCount: 1, onSubmit: () => {} },
            });
            const result = queueReducer(state, { type: 'CLOSE_DIALOG' });
            expect(result.dialogContextFiles).toBeNull();
            expect(result.dialogContextTaskName).toBeNull();
            expect(result.dialogBulkMode).toBe(false);
            expect(result.dialogAttachedContext).toBeNull();
            expect(result.dialogResolveContext).toBeNull();
        });

        it('TOGGLE_HISTORY toggles showHistory', () => {
            const result = queueReducer(makeState(), { type: 'TOGGLE_HISTORY' });
            expect(result.showHistory).toBe(true);
        });

        it('SET_HISTORY auto-shows history when entries exist', () => {
            const state = makeState({ showHistory: false });
            const result = queueReducer(state, { type: 'SET_HISTORY', history: [{ id: 'h1' }] });
            expect(result.history).toHaveLength(1);
            expect(result.showHistory).toBe(true);
        });

        it('SET_HISTORY keeps showHistory unchanged when history is empty', () => {
            const state = makeState({ showHistory: false });
            const result = queueReducer(state, { type: 'SET_HISTORY', history: [] });
            expect(result.history).toHaveLength(0);
            expect(result.showHistory).toBe(false);
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

    // ── SET_DIALOG_MODE ────────────────────────────────────────────
    describe('SET_DIALOG_MODE', () => {
        it('switches dialogMode to ask while dialog is open', () => {
            const state = makeState({ showDialog: true, dialogMode: 'task' });
            const result = queueReducer(state, { type: 'SET_DIALOG_MODE', mode: 'ask' });
            expect(result.dialogMode).toBe('ask');
            expect(result.showDialog).toBe(true);
        });

        it('switches dialogMode to task', () => {
            const state = makeState({ showDialog: true, dialogMode: 'ask' });
            const result = queueReducer(state, { type: 'SET_DIALOG_MODE', mode: 'task' });
            expect(result.dialogMode).toBe('task');
        });

        it('does not affect any other state', () => {
            const state = makeState({ showDialog: true, dialogMode: 'task', selectedTaskId: 'abc' });
            const result = queueReducer(state, { type: 'SET_DIALOG_MODE', mode: 'ask' });
            expect(result.selectedTaskId).toBe('abc');
            expect(result.showDialog).toBe(true);
        });
    });

    // ── OPEN_SCRIPT_DIALOG / CLOSE_SCRIPT_DIALOG ────────────────────
    describe('OPEN_SCRIPT_DIALOG / CLOSE_SCRIPT_DIALOG', () => {
        it('OPEN_SCRIPT_DIALOG sets showScriptDialog to true', () => {
            const result = queueReducer(makeState(), { type: 'OPEN_SCRIPT_DIALOG' });
            expect(result.showScriptDialog).toBe(true);
        });

        it('OPEN_SCRIPT_DIALOG stores workspaceId when provided', () => {
            const result = queueReducer(makeState(), { type: 'OPEN_SCRIPT_DIALOG', workspaceId: 'ws-123' });
            expect(result.showScriptDialog).toBe(true);
            expect(result.scriptDialogWorkspaceId).toBe('ws-123');
        });

        it('OPEN_SCRIPT_DIALOG defaults scriptDialogWorkspaceId to null when no workspaceId', () => {
            const result = queueReducer(makeState(), { type: 'OPEN_SCRIPT_DIALOG' });
            expect(result.scriptDialogWorkspaceId).toBeNull();
        });

        it('CLOSE_SCRIPT_DIALOG sets showScriptDialog to false', () => {
            const state = makeState({ showScriptDialog: true, scriptDialogWorkspaceId: 'ws-123' });
            const result = queueReducer(state, { type: 'CLOSE_SCRIPT_DIALOG' });
            expect(result.showScriptDialog).toBe(false);
        });

        it('CLOSE_SCRIPT_DIALOG resets scriptDialogWorkspaceId to null', () => {
            const state = makeState({ showScriptDialog: true, scriptDialogWorkspaceId: 'ws-123' });
            const result = queueReducer(state, { type: 'CLOSE_SCRIPT_DIALOG' });
            expect(result.scriptDialogWorkspaceId).toBeNull();
        });

        it('OPEN_SCRIPT_DIALOG does not affect other dialog state', () => {
            const state = makeState({ showDialog: true, selectedTaskId: 'abc' });
            const result = queueReducer(state, { type: 'OPEN_SCRIPT_DIALOG' });
            expect(result.showDialog).toBe(true);
            expect(result.selectedTaskId).toBe('abc');
        });
    });

    // ── pauseReason in stats ────────────────────────────────────────
    describe('pauseReason in stats', () => {
        it('QUEUE_UPDATED preserves pauseReason from stats', () => {
            const reason = { taskId: 't-1', displayName: 'lint.sh', failedAt: '2026-01-01T00:00:00Z' };
            const result = queueReducer(makeState(), {
                type: 'QUEUE_UPDATED',
                queue: {
                    queued: [],
                    running: [],
                    stats: { queued: 0, running: 0, total: 1, isPaused: true, isDraining: false, pauseReason: reason },
                },
            });
            expect(result.stats.pauseReason).toEqual(reason);
        });

        it('REPO_QUEUE_UPDATED preserves pauseReason from repo stats', () => {
            const reason = { taskId: 't-2', displayName: 'test.sh', failedAt: '2026-01-02T00:00:00Z' };
            const result = queueReducer(makeState(), {
                type: 'REPO_QUEUE_UPDATED',
                repoId: 'repo-a',
                queue: {
                    queued: [],
                    running: [],
                    stats: { isPaused: true, pauseReason: reason },
                },
            });
            expect(result.repoQueueMap['repo-a'].stats.pauseReason).toEqual(reason);
        });
    });

    // ── SET_TASK_SUBMITTING ──────────────────────────────────────────
    describe('SET_TASK_SUBMITTING', () => {
        it('sets isTaskSubmitting to true', () => {
            const state = makeState({ isTaskSubmitting: false });
            const result = queueReducer(state, { type: 'SET_TASK_SUBMITTING', value: true });
            expect(result.isTaskSubmitting).toBe(true);
        });

        it('sets isTaskSubmitting to false', () => {
            const state = makeState({ isTaskSubmitting: true });
            const result = queueReducer(state, { type: 'SET_TASK_SUBMITTING', value: false });
            expect(result.isTaskSubmitting).toBe(false);
        });

        it('does not affect other state', () => {
            const state = makeState({ showDialog: true, selectedTaskId: 'abc' });
            const result = queueReducer(state, { type: 'SET_TASK_SUBMITTING', value: true });
            expect(result.showDialog).toBe(true);
            expect(result.selectedTaskId).toBe('abc');
        });

        it('defaults to false in initial state', () => {
            const state = makeState();
            expect(state.isTaskSubmitting).toBe(false);
        });
    });
});
