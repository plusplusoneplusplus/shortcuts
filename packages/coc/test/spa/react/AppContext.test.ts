/**
 * Tests for AppContext reducer — process CRUD, workspace, filters, conversation cache.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { appReducer, SIDEBAR_KEY, getInitialSidebarCollapsed, type AppContextState, type AppAction } from '../../../src/server/spa/client/react/context/AppContext';

function makeState(overrides: Partial<AppContextState> = {}): AppContextState {
    return {
        processes: [],
        selectedId: null,
        workspace: '__all',
        statusFilter: '__all',
        searchQuery: '',
        expandedGroups: {},
        activeTab: 'repos',
        workspaces: [],
        selectedRepoId: null,
        activeRepoSubTab: 'info',
        reposSidebarCollapsed: false,
        selectedWikiId: null,
        selectedWikiComponentId: null,
        wikiView: 'list',
        wikiDetailInitialTab: null,
        wikiDetailInitialAdminTab: null,
        wikiAutoGenerate: false,
        wikis: [],
        selectedPipelineName: null,
        selectedChatSessionId: null,
        conversationCache: {},
        wsStatus: 'closed',
        selectedGitCommitHash: null,
        selectedRepoWikiId: null,
        selectedWorkflowProcessId: null,
        repoWikiInitialTab: null,
        repoWikiInitialAdminTab: null,
        repoWikiInitialComponentId: null,
        repoTabState: {},
        ...overrides,
    };
}

describe('AppContext reducer', () => {
    // ── PROCESS_ADDED ──────────────────────────────────────────────
    describe('PROCESS_ADDED', () => {
        it('appends a new process', () => {
            const state = makeState({ processes: [{ id: 'p1', status: 'running' }] });
            const result = appReducer(state, { type: 'PROCESS_ADDED', process: { id: 'p2', status: 'queued' } });
            expect(result.processes).toHaveLength(2);
            expect(result.processes[1].id).toBe('p2');
        });

        it('does not duplicate if process already exists', () => {
            const state = makeState({ processes: [{ id: 'p1', status: 'running' }] });
            const result = appReducer(state, { type: 'PROCESS_ADDED', process: { id: 'p1', status: 'running' } });
            expect(result.processes).toHaveLength(1);
        });
    });

    // ── PROCESS_UPDATED ────────────────────────────────────────────
    describe('PROCESS_UPDATED', () => {
        it('merges fields onto existing process', () => {
            const state = makeState({ processes: [{ id: 'p1', status: 'running', name: 'test' }] });
            const result = appReducer(state, { type: 'PROCESS_UPDATED', process: { id: 'p1', status: 'completed' } });
            expect(result.processes[0].status).toBe('completed');
            expect(result.processes[0].name).toBe('test');
        });

        it('is a no-op for unknown process id', () => {
            const state = makeState({ processes: [{ id: 'p1' }] });
            const result = appReducer(state, { type: 'PROCESS_UPDATED', process: { id: 'p999', status: 'failed' } });
            expect(result).toBe(state);
        });

        it('leaves other processes unchanged', () => {
            const state = makeState({ processes: [{ id: 'p1', status: 'running' }, { id: 'p2', status: 'queued' }] });
            const result = appReducer(state, { type: 'PROCESS_UPDATED', process: { id: 'p1', status: 'completed' } });
            expect(result.processes[1]).toEqual({ id: 'p2', status: 'queued' });
        });
    });

    // ── PROCESS_REMOVED ────────────────────────────────────────────
    describe('PROCESS_REMOVED', () => {
        it('removes the matching process', () => {
            const state = makeState({ processes: [{ id: 'p1' }, { id: 'p2' }] });
            const result = appReducer(state, { type: 'PROCESS_REMOVED', processId: 'p1' });
            expect(result.processes).toHaveLength(1);
            expect(result.processes[0].id).toBe('p2');
        });

        it('resets selectedId if removed process was selected', () => {
            const state = makeState({ processes: [{ id: 'p1' }], selectedId: 'p1' });
            const result = appReducer(state, { type: 'PROCESS_REMOVED', processId: 'p1' });
            expect(result.selectedId).toBeNull();
        });

        it('keeps selectedId if a different process was removed', () => {
            const state = makeState({ processes: [{ id: 'p1' }, { id: 'p2' }], selectedId: 'p1' });
            const result = appReducer(state, { type: 'PROCESS_REMOVED', processId: 'p2' });
            expect(result.selectedId).toBe('p1');
        });
    });

    // ── PROCESSES_CLEARED ──────────────────────────────────────────
    describe('PROCESSES_CLEARED', () => {
        it('removes completed processes', () => {
            const state = makeState({
                processes: [
                    { id: 'p1', status: 'completed' },
                    { id: 'p2', status: 'running' },
                    { id: 'p3', status: 'completed' },
                ],
            });
            const result = appReducer(state, { type: 'PROCESSES_CLEARED' });
            expect(result.processes).toHaveLength(1);
            expect(result.processes[0].id).toBe('p2');
        });

        it('resets selectedId if selected was completed', () => {
            const state = makeState({
                processes: [{ id: 'p1', status: 'completed' }],
                selectedId: 'p1',
            });
            const result = appReducer(state, { type: 'PROCESSES_CLEARED' });
            expect(result.selectedId).toBeNull();
        });

        it('keeps selectedId if selected is still present', () => {
            const state = makeState({
                processes: [{ id: 'p1', status: 'running' }, { id: 'p2', status: 'completed' }],
                selectedId: 'p1',
            });
            const result = appReducer(state, { type: 'PROCESSES_CLEARED' });
            expect(result.selectedId).toBe('p1');
        });
    });

    // ── WORKSPACE_REGISTERED ───────────────────────────────────────
    describe('WORKSPACE_REGISTERED', () => {
        it('adds a new workspace', () => {
            const state = makeState({ workspaces: [{ id: 'w1' }] });
            const result = appReducer(state, { type: 'WORKSPACE_REGISTERED', workspace: { id: 'w2' } });
            expect(result.workspaces).toHaveLength(2);
        });

        it('does not duplicate existing workspace', () => {
            const state = makeState({ workspaces: [{ id: 'w1' }] });
            const result = appReducer(state, { type: 'WORKSPACE_REGISTERED', workspace: { id: 'w1' } });
            expect(result.workspaces).toHaveLength(1);
        });
    });

    // ── Filters ────────────────────────────────────────────────────
    describe('filters', () => {
        it('SET_WORKSPACE_FILTER updates workspace', () => {
            const result = appReducer(makeState(), { type: 'SET_WORKSPACE_FILTER', value: 'ws-1' });
            expect(result.workspace).toBe('ws-1');
        });

        it('SET_STATUS_FILTER updates statusFilter', () => {
            const result = appReducer(makeState(), { type: 'SET_STATUS_FILTER', value: 'running' });
            expect(result.statusFilter).toBe('running');
        });

        it('SET_SEARCH_QUERY updates searchQuery', () => {
            const result = appReducer(makeState(), { type: 'SET_SEARCH_QUERY', value: 'test' });
            expect(result.searchQuery).toBe('test');
        });
    });

    // ── CACHE_CONVERSATION ─────────────────────────────────────────
    describe('CACHE_CONVERSATION', () => {
        it('adds a cache entry', () => {
            const state = makeState();
            const result = appReducer(state, {
                type: 'CACHE_CONVERSATION',
                processId: 'p1',
                turns: [{ role: 'assistant', content: 'hello', timeline: [] }],
            });
            expect(result.conversationCache['p1']).toBeDefined();
            expect(result.conversationCache['p1'].turns).toHaveLength(1);
        });

        it('evicts oldest when at max (50) entries', () => {
            const cache: Record<string, any> = {};
            for (let i = 0; i < 50; i++) {
                cache[`p${i}`] = { turns: [], cachedAt: Date.now() - (50 - i) * 1000 };
            }
            const state = makeState({ conversationCache: cache });
            const result = appReducer(state, {
                type: 'CACHE_CONVERSATION',
                processId: 'new',
                turns: [],
            });
            expect(Object.keys(result.conversationCache)).toHaveLength(50);
            // The oldest (p0) should be evicted
            expect(result.conversationCache['p0']).toBeUndefined();
            expect(result.conversationCache['new']).toBeDefined();
        });
    });

    // ── APPEND_TURN ────────────────────────────────────────────────
    describe('APPEND_TURN', () => {
        it('appends turn to existing cache entry', () => {
            const state = makeState({
                conversationCache: { p1: { turns: [{ role: 'user' as const, content: 'hi', timeline: [] }], cachedAt: Date.now() } },
            });
            const result = appReducer(state, {
                type: 'APPEND_TURN',
                processId: 'p1',
                turn: { role: 'assistant', content: 'hello', timeline: [] },
            });
            expect(result.conversationCache['p1'].turns).toHaveLength(2);
        });

        it('is a no-op if process not in cache', () => {
            const state = makeState();
            const result = appReducer(state, {
                type: 'APPEND_TURN',
                processId: 'p999',
                turn: { role: 'assistant', content: 'hello', timeline: [] },
            });
            expect(result).toBe(state);
        });
    });

    // ── INVALIDATE_CONVERSATION ────────────────────────────────────
    describe('INVALIDATE_CONVERSATION', () => {
        it('removes cache entry', () => {
            const state = makeState({
                conversationCache: { p1: { turns: [], cachedAt: Date.now() } },
            });
            const result = appReducer(state, { type: 'INVALIDATE_CONVERSATION', processId: 'p1' });
            expect(result.conversationCache['p1']).toBeUndefined();
        });
    });

    // ── Repo selection and sub-tabs ────────────────────────────────
    describe('repo selection and sub-tabs', () => {
        it('SET_SELECTED_REPO updates selectedRepoId', () => {
            const result = appReducer(makeState(), { type: 'SET_SELECTED_REPO', id: 'repo-123' });
            expect(result.selectedRepoId).toBe('repo-123');
        });

        it('SET_SELECTED_REPO clears selectedRepoId with null', () => {
            const state = makeState({ selectedRepoId: 'repo-123' });
            const result = appReducer(state, { type: 'SET_SELECTED_REPO', id: null });
            expect(result.selectedRepoId).toBeNull();
        });

        it('SET_REPO_SUB_TAB switches to queue', () => {
            const result = appReducer(makeState(), { type: 'SET_REPO_SUB_TAB', tab: 'queue' });
            expect(result.activeRepoSubTab).toBe('queue');
        });

        it('SET_REPO_SUB_TAB switches to tasks', () => {
            const result = appReducer(makeState(), { type: 'SET_REPO_SUB_TAB', tab: 'tasks' });
            expect(result.activeRepoSubTab).toBe('tasks');
        });

        it('SET_REPO_SUB_TAB switches to pipelines', () => {
            const result = appReducer(makeState(), { type: 'SET_REPO_SUB_TAB', tab: 'pipelines' });
            expect(result.activeRepoSubTab).toBe('pipelines');
        });

        it('SET_REPO_SUB_TAB switches to info', () => {
            const state = makeState({ activeRepoSubTab: 'queue' });
            const result = appReducer(state, { type: 'SET_REPO_SUB_TAB', tab: 'info' });
            expect(result.activeRepoSubTab).toBe('info');
        });

        it('SET_REPO_SUB_TAB switches to schedules', () => {
            const result = appReducer(makeState(), { type: 'SET_REPO_SUB_TAB', tab: 'schedules' });
            expect(result.activeRepoSubTab).toBe('schedules');
        });
    });

    // ── Per-repo tab state persistence ─────────────────────────────
    describe('per-repo tab state', () => {
        it('restores last active sub-tab when switching back to a repo', () => {
            let state = makeState({ selectedRepoId: 'repo-a', activeRepoSubTab: 'info' });
            // Switch to chat on repo-a
            state = appReducer(state, { type: 'SET_REPO_SUB_TAB', tab: 'chat' });
            // Switch to repo-b — saves repo-a's tab, defaults to info for repo-b
            state = appReducer(state, { type: 'SET_SELECTED_REPO', id: 'repo-b' });
            expect(state.activeRepoSubTab).toBe('info');
            // Switch to wiki on repo-b
            state = appReducer(state, { type: 'SET_REPO_SUB_TAB', tab: 'wiki' });
            // Switch back to repo-a — should restore chat
            state = appReducer(state, { type: 'SET_SELECTED_REPO', id: 'repo-a' });
            expect(state.activeRepoSubTab).toBe('chat');
            // Switch back to repo-b — should restore wiki
            state = appReducer(state, { type: 'SET_SELECTED_REPO', id: 'repo-b' });
            expect(state.activeRepoSubTab).toBe('wiki');
        });

        it('defaults to info when visiting a repo for the first time', () => {
            const state = makeState({ selectedRepoId: 'repo-a', activeRepoSubTab: 'queue' });
            const result = appReducer(state, { type: 'SET_SELECTED_REPO', id: 'repo-new' });
            expect(result.activeRepoSubTab).toBe('info');
        });

        it('SET_REPO_SUB_TAB records tab in repoTabState for the current repo', () => {
            const state = makeState({ selectedRepoId: 'repo-x' });
            const result = appReducer(state, { type: 'SET_REPO_SUB_TAB', tab: 'git' });
            expect(result.repoTabState['repo-x']).toBe('git');
        });

        it('SET_REPO_SUB_TAB does not record when no repo is selected', () => {
            const state = makeState({ selectedRepoId: null });
            const result = appReducer(state, { type: 'SET_REPO_SUB_TAB', tab: 'git' });
            expect(result.activeRepoSubTab).toBe('git');
            expect(Object.keys(result.repoTabState)).toHaveLength(0);
        });

        it('SET_SELECTED_REPO to null preserves repoTabState but keeps current tab', () => {
            let state = makeState({ selectedRepoId: 'repo-a', activeRepoSubTab: 'pipelines' });
            state = appReducer(state, { type: 'SET_REPO_SUB_TAB', tab: 'pipelines' });
            state = appReducer(state, { type: 'SET_SELECTED_REPO', id: null });
            expect(state.repoTabState['repo-a']).toBe('pipelines');
            expect(state.activeRepoSubTab).toBe('pipelines');
        });

        it('explicit SET_REPO_SUB_TAB after SET_SELECTED_REPO overrides the restored tab', () => {
            let state = makeState({ selectedRepoId: 'repo-a', activeRepoSubTab: 'info' });
            state = appReducer(state, { type: 'SET_REPO_SUB_TAB', tab: 'chat' });
            state = appReducer(state, { type: 'SET_SELECTED_REPO', id: 'repo-b' });
            // Router dispatches explicit sub-tab from deep-link
            state = appReducer(state, { type: 'SET_REPO_SUB_TAB', tab: 'wiki' });
            expect(state.activeRepoSubTab).toBe('wiki');
            expect(state.repoTabState['repo-b']).toBe('wiki');
        });
    });

    describe('repos sidebar', () => {
        beforeEach(() => {
            localStorage.clear();
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
        });
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('TOGGLE_REPOS_SIDEBAR collapses when currently expanded', () => {
            const state = makeState({ reposSidebarCollapsed: false });
            const result = appReducer(state, { type: 'TOGGLE_REPOS_SIDEBAR' });
            expect(result.reposSidebarCollapsed).toBe(true);
        });

        it('TOGGLE_REPOS_SIDEBAR expands when currently collapsed', () => {
            const state = makeState({ reposSidebarCollapsed: true });
            const result = appReducer(state, { type: 'TOGGLE_REPOS_SIDEBAR' });
            expect(result.reposSidebarCollapsed).toBe(false);
        });

        it('TOGGLE_REPOS_SIDEBAR persists to localStorage', () => {
            const state = makeState({ reposSidebarCollapsed: false });
            appReducer(state, { type: 'TOGGLE_REPOS_SIDEBAR' });
            expect(localStorage.getItem(SIDEBAR_KEY)).toBe('true');

            const state2 = makeState({ reposSidebarCollapsed: true });
            appReducer(state2, { type: 'TOGGLE_REPOS_SIDEBAR' });
            expect(localStorage.getItem(SIDEBAR_KEY)).toBe('false');
        });

        it('TOGGLE_REPOS_SIDEBAR fires PATCH to server', () => {
            const state = makeState({ reposSidebarCollapsed: false });
            appReducer(state, { type: 'TOGGLE_REPOS_SIDEBAR' });
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/preferences'),
                expect.objectContaining({
                    method: 'PATCH',
                    body: JSON.stringify({ reposSidebarCollapsed: true }),
                }),
            );
        });

        it('SET_REPOS_SIDEBAR_COLLAPSED sets value', () => {
            const state = makeState({ reposSidebarCollapsed: false });
            const result = appReducer(state, { type: 'SET_REPOS_SIDEBAR_COLLAPSED', value: true });
            expect(result.reposSidebarCollapsed).toBe(true);
        });

        it('SET_REPOS_SIDEBAR_COLLAPSED returns same reference if unchanged', () => {
            const state = makeState({ reposSidebarCollapsed: true });
            const result = appReducer(state, { type: 'SET_REPOS_SIDEBAR_COLLAPSED', value: true });
            expect(result).toBe(state);
        });

        it('SET_REPOS_SIDEBAR_COLLAPSED toggles from true to false', () => {
            const state = makeState({ reposSidebarCollapsed: true });
            const result = appReducer(state, { type: 'SET_REPOS_SIDEBAR_COLLAPSED', value: false });
            expect(result.reposSidebarCollapsed).toBe(false);
        });
    });

    // ── getInitialSidebarCollapsed ──────────────────────────────────
    describe('getInitialSidebarCollapsed', () => {
        beforeEach(() => {
            localStorage.clear();
        });

        it('returns false when localStorage is empty', () => {
            expect(getInitialSidebarCollapsed()).toBe(false);
        });

        it('returns true when localStorage has "true"', () => {
            localStorage.setItem(SIDEBAR_KEY, 'true');
            expect(getInitialSidebarCollapsed()).toBe(true);
        });

        it('returns false when localStorage has "false"', () => {
            localStorage.setItem(SIDEBAR_KEY, 'false');
            expect(getInitialSidebarCollapsed()).toBe(false);
        });

        it('returns false for unexpected values', () => {
            localStorage.setItem(SIDEBAR_KEY, 'garbage');
            expect(getInitialSidebarCollapsed()).toBe(false);
        });
    });

    // ── Tabs and misc ──────────────────────────────────────────────
    describe('tabs and misc', () => {
        it('SET_ACTIVE_TAB changes active tab', () => {
            const result = appReducer(makeState(), { type: 'SET_ACTIVE_TAB', tab: 'processes' });
            expect(result.activeTab).toBe('processes');
        });

        it('TOGGLE_GROUP toggles group expansion', () => {
            const state = makeState({ expandedGroups: { g1: true } });
            const result = appReducer(state, { type: 'TOGGLE_GROUP', key: 'g1' });
            expect(result.expandedGroups['g1']).toBe(false);
        });

        it('SELECT_PROCESS updates selectedId', () => {
            const result = appReducer(makeState(), { type: 'SELECT_PROCESS', id: 'p1' });
            expect(result.selectedId).toBe('p1');
        });
    });

    // ── SET_SELECTED_PIPELINE ──────────────────────────────────────
    describe('SET_SELECTED_PIPELINE', () => {
        it('sets selectedPipelineName to a string', () => {
            const result = appReducer(makeState(), { type: 'SET_SELECTED_PIPELINE', name: 'foo' });
            expect(result.selectedPipelineName).toBe('foo');
        });

        it('clears selectedPipelineName to null', () => {
            const state = makeState({ selectedPipelineName: 'bar' });
            const result = appReducer(state, { type: 'SET_SELECTED_PIPELINE', name: null });
            expect(result.selectedPipelineName).toBeNull();
        });

        it('overwrites existing selectedPipelineName', () => {
            const state = makeState({ selectedPipelineName: 'old' });
            const result = appReducer(state, { type: 'SET_SELECTED_PIPELINE', name: 'new' });
            expect(result.selectedPipelineName).toBe('new');
        });
    });

    // ── SET_SELECTED_CHAT_SESSION ──────────────────────────────────
    describe('SET_SELECTED_CHAT_SESSION', () => {
        it('sets selectedChatSessionId to a string', () => {
            const result = appReducer(makeState(), { type: 'SET_SELECTED_CHAT_SESSION', id: 'task-abc' });
            expect(result.selectedChatSessionId).toBe('task-abc');
        });

        it('clears selectedChatSessionId to null', () => {
            const state = makeState({ selectedChatSessionId: 'task-abc' });
            const result = appReducer(state, { type: 'SET_SELECTED_CHAT_SESSION', id: null });
            expect(result.selectedChatSessionId).toBeNull();
        });

        it('overwrites existing selectedChatSessionId', () => {
            const state = makeState({ selectedChatSessionId: 'old-task' });
            const result = appReducer(state, { type: 'SET_SELECTED_CHAT_SESSION', id: 'new-task' });
            expect(result.selectedChatSessionId).toBe('new-task');
        });
    });

    // ── Wiki selection ────────────────────────────────────────────────
    describe('SELECT_WIKI', () => {
        it('sets selectedWikiId and clears component', () => {
            const state = makeState({ selectedWikiComponentId: 'comp-1' });
            const result = appReducer(state, { type: 'SELECT_WIKI', wikiId: 'w1' });
            expect(result.selectedWikiId).toBe('w1');
            expect(result.selectedWikiComponentId).toBeNull();
            expect(result.wikiView).toBe('detail');
        });

        it('clears wiki selection with null', () => {
            const state = makeState({ selectedWikiId: 'w1', wikiView: 'detail' as const });
            const result = appReducer(state, { type: 'SELECT_WIKI', wikiId: null });
            expect(result.selectedWikiId).toBeNull();
            expect(result.wikiView).toBe('list');
        });
    });

    describe('SELECT_WIKI_WITH_TAB', () => {
        it('sets wiki and tab, clears component when no componentId', () => {
            const state = makeState({ selectedWikiComponentId: 'old-comp' });
            const result = appReducer(state, { type: 'SELECT_WIKI_WITH_TAB', wikiId: 'w1', tab: 'browse' });
            expect(result.selectedWikiId).toBe('w1');
            expect(result.selectedWikiComponentId).toBeNull();
            expect(result.wikiDetailInitialTab).toBe('browse');
        });

        it('preserves componentId when provided', () => {
            const state = makeState();
            const result = appReducer(state, { type: 'SELECT_WIKI_WITH_TAB', wikiId: 'w1', tab: 'browse', componentId: 'comp-1' });
            expect(result.selectedWikiId).toBe('w1');
            expect(result.selectedWikiComponentId).toBe('comp-1');
            expect(result.wikiView).toBe('detail');
        });

        it('sets componentId to null when explicitly passed null', () => {
            const state = makeState({ selectedWikiComponentId: 'comp-1' });
            const result = appReducer(state, { type: 'SELECT_WIKI_WITH_TAB', wikiId: 'w1', tab: 'ask', componentId: null });
            expect(result.selectedWikiComponentId).toBeNull();
        });

        it('sets adminTab when provided', () => {
            const result = appReducer(makeState(), { type: 'SELECT_WIKI_WITH_TAB', wikiId: 'w1', tab: 'admin', adminTab: 'seeds' });
            expect(result.wikiDetailInitialTab).toBe('admin');
            expect(result.wikiDetailInitialAdminTab).toBe('seeds');
        });

        it('defaults adminTab to null when not provided', () => {
            const result = appReducer(makeState(), { type: 'SELECT_WIKI_WITH_TAB', wikiId: 'w1', tab: 'browse' });
            expect(result.wikiDetailInitialAdminTab).toBeNull();
        });
    });

    describe('SELECT_WIKI_COMPONENT', () => {
        it('sets selectedWikiComponentId', () => {
            const result = appReducer(makeState(), { type: 'SELECT_WIKI_COMPONENT', componentId: 'comp-1' });
            expect(result.selectedWikiComponentId).toBe('comp-1');
        });

        it('clears selectedWikiComponentId with null', () => {
            const state = makeState({ selectedWikiComponentId: 'comp-1' });
            const result = appReducer(state, { type: 'SELECT_WIKI_COMPONENT', componentId: null });
            expect(result.selectedWikiComponentId).toBeNull();
        });
    });

    describe('CLEAR_WIKI_INITIAL_TAB', () => {
        it('clears wikiDetailInitialTab and wikiDetailInitialAdminTab', () => {
            const state = makeState({
                wikiDetailInitialTab: 'browse',
                wikiDetailInitialAdminTab: 'seeds',
                selectedWikiComponentId: 'comp-1',
                selectedWikiId: 'w1',
            });
            const result = appReducer(state, { type: 'CLEAR_WIKI_INITIAL_TAB' });
            expect(result.wikiDetailInitialTab).toBeNull();
            expect(result.wikiDetailInitialAdminTab).toBeNull();
        });

        it('preserves selectedWikiComponentId', () => {
            const state = makeState({
                wikiDetailInitialTab: 'browse',
                selectedWikiComponentId: 'comp-1',
                selectedWikiId: 'w1',
            });
            const result = appReducer(state, { type: 'CLEAR_WIKI_INITIAL_TAB' });
            expect(result.selectedWikiComponentId).toBe('comp-1');
            expect(result.selectedWikiId).toBe('w1');
        });

        it('preserves wikiView', () => {
            const state = makeState({
                wikiDetailInitialTab: 'admin',
                wikiView: 'detail' as const,
            });
            const result = appReducer(state, { type: 'CLEAR_WIKI_INITIAL_TAB' });
            expect(result.wikiView).toBe('detail');
        });

        it('does not clear wikiAutoGenerate', () => {
            const state = makeState({
                wikiDetailInitialTab: 'admin',
                wikiAutoGenerate: true,
            });
            const result = appReducer(state, { type: 'CLEAR_WIKI_INITIAL_TAB' });
            expect(result.wikiAutoGenerate).toBe(true);
        });
    });

    describe('SET_WIKI_AUTO_GENERATE', () => {
        it('sets wikiAutoGenerate to true', () => {
            const state = makeState({ wikiAutoGenerate: false });
            const result = appReducer(state, { type: 'SET_WIKI_AUTO_GENERATE', value: true });
            expect(result.wikiAutoGenerate).toBe(true);
        });

        it('sets wikiAutoGenerate to false', () => {
            const state = makeState({ wikiAutoGenerate: true });
            const result = appReducer(state, { type: 'SET_WIKI_AUTO_GENERATE', value: false });
            expect(result.wikiAutoGenerate).toBe(false);
        });

        it('does not affect other state', () => {
            const state = makeState({
                wikiAutoGenerate: false,
                selectedWikiId: 'w1',
                wikiDetailInitialTab: 'admin',
            });
            const result = appReducer(state, { type: 'SET_WIKI_AUTO_GENERATE', value: true });
            expect(result.selectedWikiId).toBe('w1');
            expect(result.wikiDetailInitialTab).toBe('admin');
        });
    });

    // ── Wiki CRUD ─────────────────────────────────────────────────────
    describe('wiki CRUD', () => {
        it('ADD_WIKI appends a wiki', () => {
            const result = appReducer(makeState(), { type: 'ADD_WIKI', wiki: { id: 'w1', name: 'Test' } });
            expect(result.wikis).toHaveLength(1);
            expect(result.wikis[0].id).toBe('w1');
        });

        it('UPDATE_WIKI merges fields', () => {
            const state = makeState({ wikis: [{ id: 'w1', name: 'Old', status: 'loaded' }] });
            const result = appReducer(state, { type: 'UPDATE_WIKI', wiki: { id: 'w1', name: 'New' } });
            expect(result.wikis[0].name).toBe('New');
            expect(result.wikis[0].status).toBe('loaded');
        });

        it('REMOVE_WIKI removes and clears selection if matched', () => {
            const state = makeState({ wikis: [{ id: 'w1' }], selectedWikiId: 'w1', selectedWikiComponentId: 'c1', wikiView: 'detail' as const });
            const result = appReducer(state, { type: 'REMOVE_WIKI', wikiId: 'w1' });
            expect(result.wikis).toHaveLength(0);
            expect(result.selectedWikiId).toBeNull();
            expect(result.selectedWikiComponentId).toBeNull();
            expect(result.wikiView).toBe('list');
        });
    });

    // ── SET_WS_STATUS ──────────────────────────────────────────────
    describe('SET_WS_STATUS', () => {
        it('sets wsStatus to open', () => {
            const state = makeState({ wsStatus: 'closed' });
            const result = appReducer(state, { type: 'SET_WS_STATUS', status: 'open' });
            expect(result.wsStatus).toBe('open');
        });

        it('sets wsStatus to connecting', () => {
            const state = makeState({ wsStatus: 'closed' });
            const result = appReducer(state, { type: 'SET_WS_STATUS', status: 'connecting' });
            expect(result.wsStatus).toBe('connecting');
        });

        it('sets wsStatus to closed', () => {
            const state = makeState({ wsStatus: 'open' });
            const result = appReducer(state, { type: 'SET_WS_STATUS', status: 'closed' });
            expect(result.wsStatus).toBe('closed');
        });

        it('returns same reference if status unchanged', () => {
            const state = makeState({ wsStatus: 'open' });
            const result = appReducer(state, { type: 'SET_WS_STATUS', status: 'open' });
            expect(result).toBe(state);
        });

        it('does not affect other state fields', () => {
            const state = makeState({ wsStatus: 'closed', selectedId: 'p1' });
            const result = appReducer(state, { type: 'SET_WS_STATUS', status: 'open' });
            expect(result.selectedId).toBe('p1');
            expect(result.wsStatus).toBe('open');
        });
    });

    // ── SET_GIT_COMMIT_HASH ────────────────────────────────────────
    describe('SET_GIT_COMMIT_HASH', () => {
        it('sets selectedGitCommitHash to a string', () => {
            const result = appReducer(makeState(), { type: 'SET_GIT_COMMIT_HASH', hash: 'abc1234' });
            expect(result.selectedGitCommitHash).toBe('abc1234');
        });

        it('clears selectedGitCommitHash to null', () => {
            const state = makeState({ selectedGitCommitHash: 'abc1234' });
            const result = appReducer(state, { type: 'SET_GIT_COMMIT_HASH', hash: null });
            expect(result.selectedGitCommitHash).toBeNull();
        });

        it('overwrites existing selectedGitCommitHash', () => {
            const state = makeState({ selectedGitCommitHash: 'old' });
            const result = appReducer(state, { type: 'SET_GIT_COMMIT_HASH', hash: 'new' });
            expect(result.selectedGitCommitHash).toBe('new');
        });

        it('does not affect other state fields', () => {
            const state = makeState({ selectedRepoId: 'r1' });
            const result = appReducer(state, { type: 'SET_GIT_COMMIT_HASH', hash: 'abc1234' });
            expect(result.selectedRepoId).toBe('r1');
        });
    });

    // ── Repo wiki deep-link actions ────────────────────────────────
    describe('SET_REPO_WIKI_ID', () => {
        it('sets selectedRepoWikiId', () => {
            const result = appReducer(makeState(), { type: 'SET_REPO_WIKI_ID', wikiId: 'w1' });
            expect(result.selectedRepoWikiId).toBe('w1');
        });

        it('clears selectedRepoWikiId to null', () => {
            const state = makeState({ selectedRepoWikiId: 'w1' });
            const result = appReducer(state, { type: 'SET_REPO_WIKI_ID', wikiId: null });
            expect(result.selectedRepoWikiId).toBeNull();
        });
    });

    describe('SET_REPO_WIKI_DEEP_LINK', () => {
        it('sets all four fields', () => {
            const result = appReducer(makeState(), {
                type: 'SET_REPO_WIKI_DEEP_LINK',
                wikiId: 'w1',
                tab: 'admin',
                adminTab: 'seeds',
                componentId: null,
            });
            expect(result.selectedRepoWikiId).toBe('w1');
            expect(result.repoWikiInitialTab).toBe('admin');
            expect(result.repoWikiInitialAdminTab).toBe('seeds');
            expect(result.repoWikiInitialComponentId).toBeNull();
        });

        it('sets componentId for browse tab', () => {
            const result = appReducer(makeState(), {
                type: 'SET_REPO_WIKI_DEEP_LINK',
                wikiId: 'w1',
                tab: 'browse',
                componentId: 'auth-module',
            });
            expect(result.repoWikiInitialComponentId).toBe('auth-module');
            expect(result.repoWikiInitialTab).toBe('browse');
        });

        it('defaults missing optional fields to null', () => {
            const result = appReducer(makeState(), {
                type: 'SET_REPO_WIKI_DEEP_LINK',
                wikiId: 'w1',
            });
            expect(result.selectedRepoWikiId).toBe('w1');
            expect(result.repoWikiInitialTab).toBeNull();
            expect(result.repoWikiInitialAdminTab).toBeNull();
            expect(result.repoWikiInitialComponentId).toBeNull();
        });
    });

    describe('CLEAR_REPO_WIKI_INITIAL', () => {
        it('resets initial fields but keeps selectedRepoWikiId', () => {
            const state = makeState({
                selectedRepoWikiId: 'w1',
                repoWikiInitialTab: 'ask',
                repoWikiInitialAdminTab: 'seeds',
                repoWikiInitialComponentId: 'comp-1',
            });
            const result = appReducer(state, { type: 'CLEAR_REPO_WIKI_INITIAL' });
            expect(result.selectedRepoWikiId).toBe('w1');
            expect(result.repoWikiInitialTab).toBeNull();
            expect(result.repoWikiInitialAdminTab).toBeNull();
            expect(result.repoWikiInitialComponentId).toBeNull();
        });
    });

    // ── SET_WORKFLOW_PROCESS ──────────────────────────────────────
    describe('SET_WORKFLOW_PROCESS', () => {
        it('sets selectedWorkflowProcessId to the given processId', () => {
            const result = appReducer(makeState(), { type: 'SET_WORKFLOW_PROCESS', processId: 'proc-1' });
            expect(result.selectedWorkflowProcessId).toBe('proc-1');
        });

        it('clears selectedWorkflowProcessId when null', () => {
            const state = makeState({ selectedWorkflowProcessId: 'proc-1' });
            const result = appReducer(state, { type: 'SET_WORKFLOW_PROCESS', processId: null });
            expect(result.selectedWorkflowProcessId).toBeNull();
        });

        it('replaces existing selectedWorkflowProcessId', () => {
            const state = makeState({ selectedWorkflowProcessId: 'proc-1' });
            const result = appReducer(state, { type: 'SET_WORKFLOW_PROCESS', processId: 'proc-2' });
            expect(result.selectedWorkflowProcessId).toBe('proc-2');
        });
    });
});
