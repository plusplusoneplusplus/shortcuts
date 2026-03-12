/**
 * Tests for cross-repository activity mixing fix.
 *
 * Verifies:
 * - Fix 1: Tab components use key={ws.id} to force remount on workspace change
 * - Fix 2: selectedTaskId is cleared on repo switch in MiniReposSidebar and ReposGrid
 * - Fix 3: Per-repo selectedTaskIdByRepo map in QueueContext
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { queueReducer, type QueueContextState } from '../../../src/server/spa/client/react/context/QueueContext';

// ── Source file readers ────────────────────────────────────────────────

const REPO_DETAIL_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoDetail.tsx'),
    'utf-8',
);

const MINI_SIDEBAR_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'MiniReposSidebar.tsx'),
    'utf-8',
);

const REPOS_GRID_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'ReposGrid.tsx'),
    'utf-8',
);

const QUEUE_CONTEXT_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'context', 'QueueContext.tsx'),
    'utf-8',
);

const REPO_ACTIVITY_TAB_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoActivityTab.tsx'),
    'utf-8',
);

const ROUTER_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'layout', 'Router.tsx'),
    'utf-8',
);

// ── Helper ─────────────────────────────────────────────────────────────

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

// ════════════════════════════════════════════════════════════════════════
// Fix 1: Tab components use key={ws.id} to force remount on workspace change
// ════════════════════════════════════════════════════════════════════════

describe('Fix 1: key={ws.id} on workspace-dependent tab components', () => {
    it('RepoActivityTab has key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoActivityTab key={ws.id}');
    });

    it('RepoSchedulesTab has key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoSchedulesTab key={ws.id}');
    });

    it('RepoCopilotTab has key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoCopilotTab key={ws.id}');
    });

    it('ExplorerPanel has key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<ExplorerPanel key={ws.id}');
    });

    it('RepoGitTab still has key={ws.id}', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<RepoGitTab key={ws.id}');
    });
});

// ════════════════════════════════════════════════════════════════════════
// Fix 2: selectedTaskId cleared on repo switch
// ════════════════════════════════════════════════════════════════════════

describe('Fix 2: clear selectedTaskId on repo switch', () => {
    describe('MiniReposSidebar', () => {
        it('imports useQueue', () => {
            expect(MINI_SIDEBAR_SOURCE).toContain("import { useQueue } from '../context/QueueContext'");
        });

        it('dispatches SELECT_QUEUE_TASK with null in selectRepo', () => {
            // selectRepo and expandAndSelect both clear queue selection
            const selectRepoStart = MINI_SIDEBAR_SOURCE.indexOf('const selectRepo');
            const expandStart = MINI_SIDEBAR_SOURCE.indexOf('const expandAndSelect');
            const selectRepoBody = MINI_SIDEBAR_SOURCE.slice(selectRepoStart, expandStart);
            expect(selectRepoBody).toContain("type: 'SELECT_QUEUE_TASK', id: null");
        });

        it('dispatches SELECT_QUEUE_TASK with null in expandAndSelect', () => {
            const expandStart = MINI_SIDEBAR_SOURCE.indexOf('const expandAndSelect');
            const expandBody = MINI_SIDEBAR_SOURCE.slice(expandStart, expandStart + 500);
            expect(expandBody).toContain("type: 'SELECT_QUEUE_TASK', id: null");
        });
    });

    describe('ReposGrid', () => {
        it('imports useQueue', () => {
            expect(REPOS_GRID_SOURCE).toContain("import { useQueue } from '../context/QueueContext'");
        });

        it('dispatches SELECT_QUEUE_TASK with null in selectRepo', () => {
            const selectRepoFn = REPOS_GRID_SOURCE.match(/const selectRepo = [^{]*\{([\s\S]*?)\};/);
            expect(selectRepoFn).toBeTruthy();
            expect(selectRepoFn![1]).toContain("type: 'SELECT_QUEUE_TASK', id: null");
        });
    });
});

// ════════════════════════════════════════════════════════════════════════
// Fix 3: Per-repo selectedTaskIdByRepo map
// ════════════════════════════════════════════════════════════════════════

describe('Fix 3: per-repo selectedTaskIdByRepo', () => {
    describe('QueueContext state', () => {
        it('includes selectedTaskIdByRepo in state type', () => {
            expect(QUEUE_CONTEXT_SOURCE).toContain('selectedTaskIdByRepo: Record<string, string | null>');
        });

        it('initializes selectedTaskIdByRepo as empty object', () => {
            expect(QUEUE_CONTEXT_SOURCE).toContain('selectedTaskIdByRepo: {}');
        });

        it('SELECT_QUEUE_TASK action type accepts optional repoId', () => {
            expect(QUEUE_CONTEXT_SOURCE).toContain("type: 'SELECT_QUEUE_TASK'; id: string | null; repoId?: string");
        });
    });

    describe('QueueContext reducer — SELECT_QUEUE_TASK with repoId', () => {
        it('sets both selectedTaskId and selectedTaskIdByRepo when repoId is provided', () => {
            const state = makeState();
            const result = queueReducer(state, { type: 'SELECT_QUEUE_TASK', id: 'task-1', repoId: 'repo-A' });
            expect(result.selectedTaskId).toBe('task-1');
            expect(result.selectedTaskIdByRepo['repo-A']).toBe('task-1');
        });

        it('clears per-repo selection when id is null with repoId', () => {
            const state = makeState({
                selectedTaskId: 'task-1',
                selectedTaskIdByRepo: { 'repo-A': 'task-1' },
            });
            const result = queueReducer(state, { type: 'SELECT_QUEUE_TASK', id: null, repoId: 'repo-A' });
            expect(result.selectedTaskId).toBeNull();
            expect(result.selectedTaskIdByRepo['repo-A']).toBeNull();
        });

        it('only sets global selectedTaskId when repoId is omitted (backward compat)', () => {
            const state = makeState({
                selectedTaskIdByRepo: { 'repo-A': 'task-old' },
            });
            const result = queueReducer(state, { type: 'SELECT_QUEUE_TASK', id: 'task-2' });
            expect(result.selectedTaskId).toBe('task-2');
            // Per-repo map should be unchanged
            expect(result.selectedTaskIdByRepo['repo-A']).toBe('task-old');
        });

        it('different repos maintain independent selections', () => {
            let state = makeState();
            state = queueReducer(state, { type: 'SELECT_QUEUE_TASK', id: 'task-A', repoId: 'repo-A' });
            state = queueReducer(state, { type: 'SELECT_QUEUE_TASK', id: 'task-B', repoId: 'repo-B' });
            expect(state.selectedTaskIdByRepo['repo-A']).toBe('task-A');
            expect(state.selectedTaskIdByRepo['repo-B']).toBe('task-B');
            // Global reflects the most recent selection
            expect(state.selectedTaskId).toBe('task-B');
        });

        it('clearing one repo does not affect another repo selection', () => {
            let state = makeState();
            state = queueReducer(state, { type: 'SELECT_QUEUE_TASK', id: 'task-A', repoId: 'repo-A' });
            state = queueReducer(state, { type: 'SELECT_QUEUE_TASK', id: 'task-B', repoId: 'repo-B' });
            state = queueReducer(state, { type: 'SELECT_QUEUE_TASK', id: null, repoId: 'repo-A' });
            expect(state.selectedTaskIdByRepo['repo-A']).toBeNull();
            expect(state.selectedTaskIdByRepo['repo-B']).toBe('task-B');
        });
    });

    describe('RepoActivityTab reads from per-repo map', () => {
        it('reads selectedTaskId from selectedTaskIdByRepo[workspaceId]', () => {
            expect(REPO_ACTIVITY_TAB_SOURCE).toContain('queueState.selectedTaskIdByRepo[workspaceId]');
        });

        it('does not read from global queueState.selectedTaskId', () => {
            // Should NOT have a bare `queueState.selectedTaskId` read (only the per-repo version)
            const lines = REPO_ACTIVITY_TAB_SOURCE.split('\n');
            const globalReads = lines.filter(l =>
                l.includes('queueState.selectedTaskId') && !l.includes('selectedTaskIdByRepo')
            );
            expect(globalReads).toHaveLength(0);
        });

        it('dispatches SELECT_QUEUE_TASK with repoId when selecting a task', () => {
            expect(REPO_ACTIVITY_TAB_SOURCE).toContain("type: 'SELECT_QUEUE_TASK', id, repoId: workspaceId");
        });

        it('dispatches SELECT_QUEUE_TASK with repoId when clearing selection', () => {
            expect(REPO_ACTIVITY_TAB_SOURCE).toContain("type: 'SELECT_QUEUE_TASK', id: null, repoId: workspaceId");
        });
    });

    describe('Router passes repoId in activity deep-links', () => {
        it('passes repoId when selecting a task via deep link', () => {
            expect(ROUTER_SOURCE).toContain("type: 'SELECT_QUEUE_TASK', id: decodeURIComponent(parts[3]), repoId");
        });

        it('passes repoId when clearing selection via activity URL', () => {
            expect(ROUTER_SOURCE).toContain("type: 'SELECT_QUEUE_TASK', id: null, repoId");
        });
    });
});
