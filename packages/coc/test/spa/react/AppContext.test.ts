/**
 * Tests for AppContext reducer — process CRUD, workspace, filters, conversation cache.
 */

import { describe, it, expect } from 'vitest';
import { appReducer, type AppContextState, type AppAction } from '../../../src/server/spa/client/react/context/AppContext';

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
        selectedWikiId: null,
        selectedWikiComponentId: null,
        wikiView: 'list',
        wikis: [],
        conversationCache: {},
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
});
