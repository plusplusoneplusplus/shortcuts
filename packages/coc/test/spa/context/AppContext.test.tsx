/**
 * Tests for AppContext reducer and provider — process CRUD, workspace, tab navigation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';
import { AppProvider, useApp, appReducer, type AppContextState, type AppAction, type OnboardingProgress } from '../../../src/server/spa/client/react/context/AppContext';

// ── Reducer unit tests ────────────────────────────────────────────────────────

function makeState(overrides: Partial<AppContextState> = {}): AppContextState {
    return {
        processes: [],
        processesTotal: 0,
        processesOffset: 0,
        processesLoading: false,
        selectedId: null,
        workspace: '__all',
        statusFilter: '__all',
        searchQuery: '',
        searchResults: null,
        searchLoading: false,
        expandedGroups: {},
        activeTab: 'repos',
        workspaces: [],
        selectedRepoId: null,
        activeRepoSubTab: 'settings',
        reposSidebarCollapsed: false,
        selectedWikiId: null,
        selectedWikiComponentId: null,
        wikiView: 'list',
        wikiDetailInitialTab: null,
        wikiDetailInitialAdminTab: null,
        wikiAutoGenerate: false,
        wikis: [],
        selectedRepoWikiId: null,
        repoWikiInitialTab: null,
        repoWikiInitialAdminTab: null,
        repoWikiInitialComponentId: null,
        selectedWorkflowName: null,
        selectedWorkflowRunProcessId: null,
        selectedScheduleId: null,
        selectedGitCommitHash: null,
        selectedGitFilePath: null,
        selectedPrId: null,
        selectedWorkflowProcessId: null,
        selectedExplorerPath: null,
        selectedNotePath: null,
        conversationCache: {},
        wsStatus: 'closed',
        activeMemorySubTab: 'entries',
        activeSkillsSubTab: 'installed',
        repoTabState: {},
        wikiTabState: {},
        repoSubTabNavState: {},
        settingsSection: 'info',
        hasSeenWelcome: false,
        onboardingProgress: { hasRunWorkflow: false, hasOpenedWiki: false, hasUsedChat: false },
        dismissedTips: [],
        preferencesLoaded: false,
        ...overrides,
    } as AppContextState;
}

describe('AppContext reducer', () => {
    describe('PROCESS_ADDED', () => {
        it('appends a new process', () => {
            const state = makeState();
            const p = { id: 'p1', status: 'running' };
            const result = appReducer(state, { type: 'PROCESS_ADDED', process: p });
            expect(result.processes).toHaveLength(1);
            expect(result.processes[0].id).toBe('p1');
        });

        it('does not duplicate a process with the same id', () => {
            const p = { id: 'p1', status: 'running' };
            let state = makeState({ processes: [p] });
            state = appReducer(state, { type: 'PROCESS_ADDED', process: p });
            expect(state.processes).toHaveLength(1);
        });
    });

    describe('PROCESS_UPDATED', () => {
        it('merges partial fields without overwriting unrelated fields', () => {
            const p = { id: 'p1', status: 'running', title: 'original' };
            const state = makeState({ processes: [p] });
            const result = appReducer(state, { type: 'PROCESS_UPDATED', process: { id: 'p1', status: 'completed' } });
            expect(result.processes[0].status).toBe('completed');
            expect(result.processes[0].title).toBe('original');
        });

        it('returns same state when process id not found', () => {
            const state = makeState();
            const result = appReducer(state, { type: 'PROCESS_UPDATED', process: { id: 'unknown' } });
            expect(result).toBe(state);
        });
    });

    describe('PROCESS_REMOVED', () => {
        it('removes process from list', () => {
            const state = makeState({ processes: [{ id: 'p1' }, { id: 'p2' }] });
            const result = appReducer(state, { type: 'PROCESS_REMOVED', processId: 'p1' });
            expect(result.processes).toHaveLength(1);
            expect(result.processes[0].id).toBe('p2');
        });

        it('clears selectedId when the removed process was selected', () => {
            const state = makeState({ processes: [{ id: 'p1' }], selectedId: 'p1' });
            const result = appReducer(state, { type: 'PROCESS_REMOVED', processId: 'p1' });
            expect(result.selectedId).toBe(null);
        });

        it('preserves selectedId when a different process is removed', () => {
            const state = makeState({ processes: [{ id: 'p1' }, { id: 'p2' }], selectedId: 'p2' });
            const result = appReducer(state, { type: 'PROCESS_REMOVED', processId: 'p1' });
            expect(result.selectedId).toBe('p2');
        });
    });

    describe('SELECT_PROCESS', () => {
        it('sets selectedId', () => {
            const state = makeState({ processes: [{ id: 'p1' }] });
            const result = appReducer(state, { type: 'SELECT_PROCESS', id: 'p1' });
            expect(result.selectedId).toBe('p1');
        });

        it('clears selectedId when null', () => {
            const state = makeState({ selectedId: 'p1' });
            const result = appReducer(state, { type: 'SELECT_PROCESS', id: null });
            expect(result.selectedId).toBe(null);
        });
    });

    describe('SET_ACTIVE_TAB', () => {
        it('updates activeTab', () => {
            const state = makeState({ activeTab: 'repos' });
            const result = appReducer(state, { type: 'SET_ACTIVE_TAB', tab: 'processes' });
            expect(result.activeTab).toBe('processes');
        });

        it('sets hasOpenedWiki and fires PATCH when switching to wiki tab', () => {
            const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
            vi.stubGlobal('fetch', fetchSpy);
            const state = makeState({
                onboardingProgress: { hasRunWorkflow: false, hasOpenedWiki: false, hasUsedChat: false },
            });
            const result = appReducer(state, { type: 'SET_ACTIVE_TAB', tab: 'wiki' });
            expect(result.activeTab).toBe('wiki');
            expect(result.onboardingProgress.hasOpenedWiki).toBe(true);
            expect(fetchSpy).toHaveBeenCalledWith(
                expect.stringContaining('/preferences'),
                expect.objectContaining({
                    method: 'PATCH',
                    body: JSON.stringify({ onboardingProgress: { hasRunWorkflow: false, hasOpenedWiki: true, hasUsedChat: false } }),
                }),
            );
            vi.unstubAllGlobals();
        });

        it('does not fire PATCH when hasOpenedWiki is already true', () => {
            const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
            vi.stubGlobal('fetch', fetchSpy);
            const state = makeState({
                onboardingProgress: { hasRunWorkflow: false, hasOpenedWiki: true, hasUsedChat: false },
            });
            const result = appReducer(state, { type: 'SET_ACTIVE_TAB', tab: 'wiki' });
            expect(result.activeTab).toBe('wiki');
            expect(result.onboardingProgress.hasOpenedWiki).toBe(true);
            expect(fetchSpy).not.toHaveBeenCalled();
            vi.unstubAllGlobals();
        });

        it('does not change hasOpenedWiki when switching to a non-wiki tab', () => {
            const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
            vi.stubGlobal('fetch', fetchSpy);
            const state = makeState({
                onboardingProgress: { hasRunWorkflow: false, hasOpenedWiki: false, hasUsedChat: false },
            });
            const result = appReducer(state, { type: 'SET_ACTIVE_TAB', tab: 'repos' });
            expect(result.activeTab).toBe('repos');
            expect(result.onboardingProgress.hasOpenedWiki).toBe(false);
            expect(fetchSpy).not.toHaveBeenCalled();
            vi.unstubAllGlobals();
        });
    });

    describe('WORKSPACES_LOADED', () => {
        it('replaces workspaces list', () => {
            const state = makeState({ workspaces: [] });
            const ws = [{ id: 'ws-1', name: 'My Repo' }];
            const result = appReducer(state, { type: 'WORKSPACES_LOADED', workspaces: ws });
            expect(result.workspaces).toEqual(ws);
        });
    });

    describe('SET_WS_STATUS', () => {
        it('updates wsStatus', () => {
            const state = makeState({ wsStatus: 'closed' });
            const result = appReducer(state, { type: 'SET_WS_STATUS', status: 'open' });
            expect(result.wsStatus).toBe('open');
        });
    });

    describe('CACHE_CONVERSATION', () => {
        it('caches conversation turns', () => {
            const state = makeState();
            const turns = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }];
            const result = appReducer(state, { type: 'CACHE_CONVERSATION', processId: 'p1', turns } as AppAction);
            expect(result.conversationCache['p1']).toBeDefined();
            expect(result.conversationCache['p1'].turns).toEqual(turns);
        });

        it('rejects stale data with fewer turns than existing cache (cache poisoning guard)', () => {
            const existingTurns = [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hello' },
                { role: 'user', content: 'follow-up' },
                { role: 'assistant', content: 'response' },
            ];
            const state = makeState({
                conversationCache: { 'p1': { turns: existingTurns, cachedAt: Date.now() } },
            });
            const staleTurns = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }];
            const result = appReducer(state, { type: 'CACHE_CONVERSATION', processId: 'p1', turns: staleTurns } as AppAction);
            // Should preserve existing cache, not overwrite with stale data
            expect(result.conversationCache['p1'].turns).toEqual(existingTurns);
            expect(result).toBe(state);
        });

        it('accepts update with same or more turns than existing cache', () => {
            const existingTurns = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }];
            const state = makeState({
                conversationCache: { 'p1': { turns: existingTurns, cachedAt: Date.now() - 1000 } },
            });
            const newTurns = [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hello' },
                { role: 'user', content: 'more' },
            ];
            const result = appReducer(state, { type: 'CACHE_CONVERSATION', processId: 'p1', turns: newTurns } as AppAction);
            expect(result.conversationCache['p1'].turns).toEqual(newTurns);
        });

        it('rejects stale data with same turn count but less total content', () => {
            const existingTurns = [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'This is a complete response with lots of detail.' },
            ];
            const state = makeState({
                conversationCache: { 'p1': { turns: existingTurns, cachedAt: Date.now() } },
            });
            const staleTurns = [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: '' }, // stale: content not flushed yet
            ];
            const result = appReducer(state, { type: 'CACHE_CONVERSATION', processId: 'p1', turns: staleTurns } as AppAction);
            expect(result.conversationCache['p1'].turns).toEqual(existingTurns);
            expect(result).toBe(state);
        });

        it('accepts data with same turn count but equal or more content', () => {
            const existingTurns = [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hello' },
            ];
            const state = makeState({
                conversationCache: { 'p1': { turns: existingTurns, cachedAt: Date.now() - 1000 } },
            });
            const newTurns = [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hello, how are you?' }, // more content
            ];
            const result = appReducer(state, { type: 'CACHE_CONVERSATION', processId: 'p1', turns: newTurns } as AppAction);
            expect(result.conversationCache['p1'].turns).toEqual(newTurns);
        });

        it('stores dirty flag from action', () => {
            const turns = [{ role: 'user', content: 'hi' }];
            const state = makeState({});
            const result = appReducer(state, { type: 'CACHE_CONVERSATION', processId: 'p1', turns, dirty: true } as AppAction);
            expect(result.conversationCache['p1'].dirty).toBe(true);
        });

        it('defaults dirty to false when not provided', () => {
            const turns = [{ role: 'user', content: 'hi' }];
            const state = makeState({});
            const result = appReducer(state, { type: 'CACHE_CONVERSATION', processId: 'p1', turns } as AppAction);
            expect(result.conversationCache['p1'].dirty).toBe(false);
        });
    });
});

// ── Provider integration tests ────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    // AppProvider fetches /preferences on mount — return empty prefs
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function Wrapper({ children }: { children: ReactNode }) {
    return <AppProvider>{children}</AppProvider>;
}

function StateDisplay() {
    const { state, dispatch } = useApp();
    return (
        <div>
            <span data-testid="process-count">{state.processes.length}</span>
            <span data-testid="tab">{state.activeTab}</span>
            <button onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', tab: 'processes' })}>
                Switch Tab
            </button>
        </div>
    );
}

describe('AppContext provider', () => {
    it('renders children with default state', () => {
        render(<Wrapper><StateDisplay /></Wrapper>);
        expect(screen.getByTestId('process-count').textContent).toBe('0');
        expect(screen.getByTestId('tab').textContent).toBe('repos');
    });

    it('dispatches SET_ACTIVE_TAB and updates state', async () => {
        render(<Wrapper><StateDisplay /></Wrapper>);
        act(() => {
            screen.getByRole('button').click();
        });
        await waitFor(() => {
            expect(screen.getByTestId('tab').textContent).toBe('processes');
        });
    });
});
