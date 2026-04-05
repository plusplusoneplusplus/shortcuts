/**
 * Tests for QueueContext reducer and provider — queue updates, drain lifecycle, dialog.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { type ReactNode } from 'react';
import { QueueProvider, useQueue, queueReducer, type QueueContextState, type QueueAction } from '../../../src/server/spa/client/react/context/QueueContext';

// ── Helper ────────────────────────────────────────────────────────────────────

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
        dialogInitialPrompt: null,
        dialogMode: 'task',
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

// ── Reducer tests ──────────────────────────────────────────────────────────────

describe('queueReducer', () => {
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
                queue: { queued: [], running: [], stats: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false, isDraining: false } },
            });
            expect(result.queueInitialized).toBe(true);
        });

        it('preserves existing history when action history is empty array (WS→fetch race)', () => {
            const existingHistory = [{ id: 'done-1', status: 'done' }];
            const state = makeState({ history: existingHistory });
            const result = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: { queued: [], running: [], history: [], stats: undefined },
            });
            expect(result.history).toEqual(existingHistory);
        });

        it('preserves existing history when action history is undefined', () => {
            const existingHistory = [{ id: 'done-1', status: 'done' }];
            const state = makeState({ history: existingHistory });
            const result = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: { queued: [], running: [], history: undefined, stats: undefined },
            });
            expect(result.history).toEqual(existingHistory);
        });

        it('replaces history when action history is non-empty', () => {
            const existingHistory = [{ id: 'done-old', status: 'done' }];
            const newHistory = [{ id: 'done-new', status: 'done' }];
            const state = makeState({ history: existingHistory });
            const result = queueReducer(state, {
                type: 'QUEUE_UPDATED',
                queue: { queued: [], running: [], history: newHistory, stats: undefined },
            });
            expect(result.history).toEqual(newHistory);
        });
    });

    describe('REPO_QUEUE_UPDATED', () => {
        it('updates per-repo queue without affecting global queue', () => {
            const state = makeState({ queued: [{ id: 'global-q1' }] });
            const result = queueReducer(state, {
                type: 'REPO_QUEUE_UPDATED',
                repoId: 'repo-A',
                queue: { queued: [{ id: 'repo-a-q1' }], running: [], stats: undefined },
            });
            expect(result.repoQueueMap['repo-A'].queued).toHaveLength(1);
            expect(result.queued).toHaveLength(1); // global unchanged
        });

        it('does not affect other repos when updating one', () => {
            const state = makeState({
                repoQueueMap: { 'repo-B': { queued: [{ id: 'b1' }], running: [], history: [], stats: makeState().stats } },
            });
            const result = queueReducer(state, {
                type: 'REPO_QUEUE_UPDATED',
                repoId: 'repo-A',
                queue: { queued: [{ id: 'a1' }], running: [] },
            });
            expect(result.repoQueueMap['repo-B'].queued[0].id).toBe('b1');
        });

        it('preserves existing repo history when action history is empty array (WS→fetch race)', () => {
            const existingHistory = [{ id: 'done-1', status: 'done' }];
            const state = makeState({
                repoQueueMap: { 'repo-A': { queued: [], running: [], history: existingHistory, stats: makeState().stats } },
            });
            const result = queueReducer(state, {
                type: 'REPO_QUEUE_UPDATED',
                repoId: 'repo-A',
                queue: { queued: [], running: [], history: [], stats: undefined },
            });
            expect(result.repoQueueMap['repo-A'].history).toEqual(existingHistory);
        });

        it('preserves existing repo history when action history is undefined', () => {
            const existingHistory = [{ id: 'done-1', status: 'done' }];
            const state = makeState({
                repoQueueMap: { 'repo-A': { queued: [], running: [], history: existingHistory, stats: makeState().stats } },
            });
            const result = queueReducer(state, {
                type: 'REPO_QUEUE_UPDATED',
                repoId: 'repo-A',
                queue: { queued: [], running: [], history: undefined, stats: undefined },
            });
            expect(result.repoQueueMap['repo-A'].history).toEqual(existingHistory);
        });

        it('replaces repo history when action history is non-empty', () => {
            const existingHistory = [{ id: 'done-old', status: 'done' }];
            const newHistory = [{ id: 'done-new', status: 'done' }];
            const state = makeState({
                repoQueueMap: { 'repo-A': { queued: [], running: [], history: existingHistory, stats: makeState().stats } },
            });
            const result = queueReducer(state, {
                type: 'REPO_QUEUE_UPDATED',
                repoId: 'repo-A',
                queue: { queued: [], running: [], history: newHistory, stats: undefined },
            });
            expect(result.repoQueueMap['repo-A'].history).toEqual(newHistory);
        });

        it('starts with empty history for new repo when action history is empty', () => {
            const state = makeState();
            const result = queueReducer(state, {
                type: 'REPO_QUEUE_UPDATED',
                repoId: 'repo-new',
                queue: { queued: [], running: [], history: [], stats: undefined },
            });
            expect(result.repoQueueMap['repo-new'].history).toEqual([]);
        });
    });

    describe('DRAIN_START / DRAIN_PROGRESS / DRAIN_COMPLETE', () => {
        it('DRAIN_START sets draining=true', () => {
            const state = makeState();
            const result = queueReducer(state, { type: 'DRAIN_START', queued: 5, running: 2 });
            expect(result.draining).toBe(true);
            expect(result.drainQueued).toBe(5);
            expect(result.drainRunning).toBe(2);
        });

        it('DRAIN_PROGRESS updates counters', () => {
            const state = makeState({ draining: true, drainQueued: 5, drainRunning: 2 });
            const result = queueReducer(state, { type: 'DRAIN_PROGRESS', queued: 3, running: 1 });
            expect(result.drainQueued).toBe(3);
            expect(result.drainRunning).toBe(1);
        });

        it('DRAIN_COMPLETE sets draining=false and clears counters', () => {
            const state = makeState({ draining: true, drainQueued: 3, drainRunning: 1 });
            const result = queueReducer(state, { type: 'DRAIN_COMPLETE' });
            expect(result.draining).toBe(false);
            expect(result.drainQueued).toBe(0);
            expect(result.drainRunning).toBe(0);
        });
    });

    describe('OPEN_DIALOG / CLOSE_DIALOG', () => {
        it('OPEN_DIALOG sets showDialog=true with folder/workspace', () => {
            const state = makeState();
            const result = queueReducer(state, { type: 'OPEN_DIALOG', folderPath: '/tasks', workspaceId: 'ws-1', mode: 'task' });
            expect(result.showDialog).toBe(true);
            expect(result.dialogInitialFolderPath).toBe('/tasks');
            expect(result.dialogInitialWorkspaceId).toBe('ws-1');
        });

        it('OPEN_DIALOG sets dialogInitialPrompt when provided', () => {
            const state = makeState();
            const result = queueReducer(state, { type: 'OPEN_DIALOG', mode: 'ask', initialPrompt: 'Context from code review:\n- File: foo.ts\n' });
            expect(result.showDialog).toBe(true);
            expect(result.dialogInitialPrompt).toBe('Context from code review:\n- File: foo.ts\n');
            expect(result.dialogMode).toBe('ask');
        });

        it('OPEN_DIALOG leaves dialogInitialPrompt null when not provided', () => {
            const state = makeState();
            const result = queueReducer(state, { type: 'OPEN_DIALOG', mode: 'ask' });
            expect(result.dialogInitialPrompt).toBeNull();
        });

        it('CLOSE_DIALOG sets showDialog=false and clears context', () => {
            const state = makeState({ showDialog: true, dialogInitialFolderPath: '/tasks', dialogInitialWorkspaceId: 'ws-1' });
            const result = queueReducer(state, { type: 'CLOSE_DIALOG' });
            expect(result.showDialog).toBe(false);
            expect(result.dialogInitialFolderPath).toBe(null);
            expect(result.dialogInitialWorkspaceId).toBe(null);
        });

        it('CLOSE_DIALOG clears dialogInitialPrompt', () => {
            const state = makeState({ showDialog: true, dialogInitialPrompt: 'some prompt' });
            const result = queueReducer(state, { type: 'CLOSE_DIALOG' });
            expect(result.dialogInitialPrompt).toBeNull();
        });
    });

    describe('SELECT_QUEUE_TASK', () => {
        it('sets selectedTaskId', () => {
            const state = makeState();
            const result = queueReducer(state, { type: 'SELECT_QUEUE_TASK', id: 'task-1' });
            expect(result.selectedTaskId).toBe('task-1');
        });

        it('sets per-repo selection when repoId provided', () => {
            const state = makeState();
            const result = queueReducer(state, { type: 'SELECT_QUEUE_TASK', id: 'task-1', repoId: 'repo-A' });
            expect(result.selectedTaskIdByRepo['repo-A']).toBe('task-1');
        });

        it('per-repo selection does not affect other repos', () => {
            const state = makeState({ selectedTaskIdByRepo: { 'repo-B': 'task-b' } });
            const result = queueReducer(state, { type: 'SELECT_QUEUE_TASK', id: 'task-a', repoId: 'repo-A' });
            expect(result.selectedTaskIdByRepo['repo-B']).toBe('task-b');
        });
    });
});

// ── Provider integration tests ────────────────────────────────────────────────

function Wrapper({ children }: { children: ReactNode }) {
    return <QueueProvider>{children}</QueueProvider>;
}

function QueueStateDisplay() {
    const { state, dispatch } = useQueue();
    return (
        <div>
            <span data-testid="draining">{String(state.draining)}</span>
            <span data-testid="dialog">{String(state.showDialog)}</span>
            <button data-testid="btn-drain" onClick={() => dispatch({ type: 'DRAIN_START', queued: 3, running: 1 })}>
                Start Drain
            </button>
            <button data-testid="btn-dialog" onClick={() => dispatch({ type: 'OPEN_DIALOG' })}>
                Open Dialog
            </button>
        </div>
    );
}

describe('QueueContext provider', () => {
    it('renders with default state', () => {
        render(<Wrapper><QueueStateDisplay /></Wrapper>);
        expect(screen.getByTestId('draining').textContent).toBe('false');
        expect(screen.getByTestId('dialog').textContent).toBe('false');
    });

    it('DRAIN_START updates draining state in provider', async () => {
        render(<Wrapper><QueueStateDisplay /></Wrapper>);
        act(() => { screen.getByTestId('btn-drain').click(); });
        await waitFor(() => {
            expect(screen.getByTestId('draining').textContent).toBe('true');
        });
    });

    it('OPEN_DIALOG updates dialog state in provider', async () => {
        render(<Wrapper><QueueStateDisplay /></Wrapper>);
        act(() => { screen.getByTestId('btn-dialog').click(); });
        await waitFor(() => {
            expect(screen.getByTestId('dialog').textContent).toBe('true');
        });
    });
});
