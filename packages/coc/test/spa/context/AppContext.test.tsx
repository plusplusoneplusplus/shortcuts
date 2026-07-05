/**
 * Tests for AppContext reducer and provider — process CRUD, workspace, tab navigation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getGlobal: vi.fn().mockResolvedValue({}),
            patchGlobal: vi.fn().mockResolvedValue({}),
            getRepo: vi.fn().mockResolvedValue({}),
            patchRepo: vi.fn().mockResolvedValue({}),
        },
    }),
}));

import { AppProvider, useApp, appReducer, type AppContextState, type AppAction, type OnboardingProgress } from '../../../src/server/spa/client/react/contexts/AppContext';

// ── Reducer unit tests ────────────────────────────────────────────────────────

function makeState(overrides: Partial<AppContextState> = {}): AppContextState {
    return {
        processes: [],
        selectedId: null,
        workspace: '__all',
        statusFilter: '__all',
        typeFilter: '__all',
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
        activeMemorySubTab: 'bounded',
        activeSkillsSubTab: 'installed',
        repoTabState: {},
        repoRouteState: {},
        notePathState: {},
        wikiTabState: {},
        repoSubTabNavState: {},
        settingsSection: 'info',
        hasSeenWelcome: false,
        onboardingProgress: { hasRunWorkflow: false, hasOpenedWiki: false, hasUsedChat: false },
        dismissedTips: [],
        preferencesLoaded: false,
        preferencesLoadFailed: false,
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

        it('sets hasOpenedWiki without performing persistence in the reducer', () => {
            const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
            vi.stubGlobal('fetch', fetchSpy);
            const state = makeState({
                onboardingProgress: { hasRunWorkflow: false, hasOpenedWiki: false, hasUsedChat: false },
            });
            const result = appReducer(state, { type: 'SET_ACTIVE_TAB', tab: 'wiki' });
            expect(result.activeTab).toBe('wiki');
            expect(result.onboardingProgress.hasOpenedWiki).toBe(true);
            expect(fetchSpy).not.toHaveBeenCalled();
            vi.unstubAllGlobals();
        });

        it('does not perform persistence when hasOpenedWiki is already true', () => {
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

    describe('SET_WELCOME_PREFERENCES', () => {
        it('sets all welcome fields from payload and marks preferencesLoaded', () => {
            const state = makeState();
            const result = appReducer(state, {
                type: 'SET_WELCOME_PREFERENCES',
                payload: {
                    hasSeenWelcome: true,
                    onboardingProgress: { hasRunWorkflow: true, hasOpenedWiki: false, hasUsedChat: true },
                    dismissedTips: ['tip-1', 'tip-2'],
                },
            });
            expect(result.hasSeenWelcome).toBe(true);
            expect(result.onboardingProgress).toEqual({ hasRunWorkflow: true, hasOpenedWiki: false, hasUsedChat: true });
            expect(result.dismissedTips).toEqual(['tip-1', 'tip-2']);
            expect(result.preferencesLoaded).toBe(true);
        });

        it('keeps defaults when payload fields are undefined', () => {
            const state = makeState({
                hasSeenWelcome: true,
                onboardingProgress: { hasRunWorkflow: true, hasOpenedWiki: false, hasUsedChat: false },
                dismissedTips: ['tip-a'],
            });
            const result = appReducer(state, { type: 'SET_WELCOME_PREFERENCES', payload: {} });
            expect(result.hasSeenWelcome).toBe(true);
            expect(result.onboardingProgress).toEqual({ hasRunWorkflow: true, hasOpenedWiki: false, hasUsedChat: false });
            expect(result.dismissedTips).toEqual(['tip-a']);
            expect(result.preferencesLoaded).toBe(true);
        });

        it('merges partial onboardingProgress without clobbering other fields', () => {
            const state = makeState({
                onboardingProgress: { hasRunWorkflow: true, hasOpenedWiki: false, hasUsedChat: false },
            });
            const result = appReducer(state, {
                type: 'SET_WELCOME_PREFERENCES',
                payload: { onboardingProgress: { hasOpenedWiki: true } },
            });
            expect(result.onboardingProgress).toEqual({ hasRunWorkflow: true, hasOpenedWiki: true, hasUsedChat: false });
        });
    });

    describe('DISMISS_WELCOME', () => {
        it('sets hasSeenWelcome to true', () => {
            const state = makeState({ hasSeenWelcome: false });
            const result = appReducer(state, { type: 'DISMISS_WELCOME' });
            expect(result.hasSeenWelcome).toBe(true);
        });

        it('does not perform persistence in the reducer', () => {
            const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
            vi.stubGlobal('fetch', fetchSpy);
            const state = makeState();
            appReducer(state, { type: 'DISMISS_WELCOME' });
            expect(fetchSpy).not.toHaveBeenCalled();
            vi.unstubAllGlobals();
        });
    });

    describe('UPDATE_ONBOARDING', () => {
        it('merges partial progress without clobbering other fields', () => {
            const state = makeState({
                onboardingProgress: { hasRunWorkflow: false, hasOpenedWiki: false, hasUsedChat: false },
            });
            const result = appReducer(state, { type: 'UPDATE_ONBOARDING', payload: { hasRunWorkflow: true } });
            expect(result.onboardingProgress).toEqual({ hasRunWorkflow: true, hasOpenedWiki: false, hasUsedChat: false });
        });

        it('does not perform persistence in the reducer', () => {
            const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
            vi.stubGlobal('fetch', fetchSpy);
            const state = makeState({
                onboardingProgress: { hasRunWorkflow: false, hasOpenedWiki: true, hasUsedChat: false },
            });
            appReducer(state, { type: 'UPDATE_ONBOARDING', payload: { hasUsedChat: true } });
            expect(fetchSpy).not.toHaveBeenCalled();
            vi.unstubAllGlobals();
        });
    });

    describe('DISMISS_TIP', () => {
        it('appends a new tipId to dismissedTips', () => {
            const state = makeState({ dismissedTips: ['tip-a'] });
            const result = appReducer(state, { type: 'DISMISS_TIP', payload: { tipId: 'tip-b' } });
            expect(result.dismissedTips).toEqual(['tip-a', 'tip-b']);
        });

        it('does not perform persistence in the reducer', () => {
            const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
            vi.stubGlobal('fetch', fetchSpy);
            const state = makeState({ dismissedTips: [] });
            appReducer(state, { type: 'DISMISS_TIP', payload: { tipId: 'tip-x' } });
            expect(fetchSpy).not.toHaveBeenCalled();
            vi.unstubAllGlobals();
        });

        it('returns same state reference for duplicate tipId (no-op)', () => {
            const state = makeState({ dismissedTips: ['tip-a'] });
            const result = appReducer(state, { type: 'DISMISS_TIP', payload: { tipId: 'tip-a' } });
            expect(result).toBe(state);
        });

        it('does not fire a PATCH for duplicate tipId', () => {
            const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
            vi.stubGlobal('fetch', fetchSpy);
            const state = makeState({ dismissedTips: ['tip-a'] });
            appReducer(state, { type: 'DISMISS_TIP', payload: { tipId: 'tip-a' } });
            expect(fetchSpy).not.toHaveBeenCalled();
            vi.unstubAllGlobals();
        });
    });

    describe('SET_SELECTED_NOTE_PATH', () => {
        it('updates selectedNotePath', () => {
            const state = makeState({ selectedNotePath: null });
            const result = appReducer(state, { type: 'SET_SELECTED_NOTE_PATH', notePath: 'Notebook/Page1' });
            expect(result.selectedNotePath).toBe('Notebook/Page1');
        });

        it('returns same state reference when path is unchanged (no-op)', () => {
            const state = makeState({ selectedNotePath: 'Notebook/Page1' });
            const result = appReducer(state, { type: 'SET_SELECTED_NOTE_PATH', notePath: 'Notebook/Page1' });
            expect(result).toBe(state);
        });

        it('returns same state reference when setting null to null', () => {
            const state = makeState({ selectedNotePath: null });
            const result = appReducer(state, { type: 'SET_SELECTED_NOTE_PATH', notePath: null });
            expect(result).toBe(state);
        });

        it('updates notePathState for the current workspace when selectedRepoId is set', () => {
            const state = makeState({ selectedRepoId: 'ws-a', selectedNotePath: null, notePathState: {} });
            const result = appReducer(state, { type: 'SET_SELECTED_NOTE_PATH', notePath: 'journal/today.md' });
            expect(result.notePathState['ws-a']).toBe('journal/today.md');
        });

        it('does not touch notePathState when no workspace is selected', () => {
            const state = makeState({ selectedRepoId: null, selectedNotePath: null, notePathState: {} });
            const result = appReducer(state, { type: 'SET_SELECTED_NOTE_PATH', notePath: 'journal/today.md' });
            expect(result.notePathState).toEqual({});
        });

        it('clears workspace note in notePathState when path is set to null', () => {
            const state = makeState({ selectedRepoId: 'ws-a', selectedNotePath: 'journal/today.md', notePathState: { 'ws-a': 'journal/today.md' } });
            const result = appReducer(state, { type: 'SET_SELECTED_NOTE_PATH', notePath: null });
            expect(result.notePathState['ws-a']).toBeNull();
        });
    });

    describe('SET_SELECTED_REPO note-path persistence', () => {
        it('saves selectedNotePath into notePathState for the previous workspace on switch', () => {
            const state = makeState({
                selectedRepoId: 'ws-a',
                selectedNotePath: 'journal/today.md',
                notePathState: {},
            });
            const result = appReducer(state, { type: 'SET_SELECTED_REPO', id: 'ws-b' });
            expect(result.notePathState['ws-a']).toBe('journal/today.md');
        });

        it('restores selectedNotePath from notePathState when switching to a workspace with a saved path', () => {
            const state = makeState({
                selectedRepoId: 'ws-a',
                selectedNotePath: 'current.md',
                notePathState: { 'ws-b': 'archive/old.md' },
            });
            const result = appReducer(state, { type: 'SET_SELECTED_REPO', id: 'ws-b' });
            expect(result.selectedNotePath).toBe('archive/old.md');
        });

        it('resets selectedNotePath to null when switching to a workspace with no saved path', () => {
            const state = makeState({
                selectedRepoId: 'ws-a',
                selectedNotePath: 'journal/today.md',
                notePathState: {},
            });
            const result = appReducer(state, { type: 'SET_SELECTED_REPO', id: 'ws-b' });
            expect(result.selectedNotePath).toBeNull();
        });

        it('round-trips: open note in A → switch to B → switch back to A → note path restored', () => {
            // Step 1: open a note in ws-a
            let state = makeState({ selectedRepoId: 'ws-a', selectedNotePath: null, notePathState: {} });
            state = appReducer(state, { type: 'SET_SELECTED_NOTE_PATH', notePath: 'journal/today.md' });
            expect(state.selectedNotePath).toBe('journal/today.md');

            // Step 2: switch to ws-b (saves ws-a path)
            state = appReducer(state, { type: 'SET_SELECTED_REPO', id: 'ws-b' });
            expect(state.selectedNotePath).toBeNull();
            expect(state.notePathState['ws-a']).toBe('journal/today.md');

            // Step 3: switch back to ws-a (restores path)
            state = appReducer(state, { type: 'SET_SELECTED_REPO', id: 'ws-a' });
            expect(state.selectedNotePath).toBe('journal/today.md');
        });
    });

    describe('COMPLETE_TOUR', () => {
        it('sets hasCompletedTour to true in onboardingProgress', () => {
            const state = makeState();
            const result = appReducer(state, { type: 'COMPLETE_TOUR' });
            expect(result.onboardingProgress.hasCompletedTour).toBe(true);
        });

        it('preserves other onboardingProgress fields', () => {
            const state = makeState({
                onboardingProgress: {
                    hasRunWorkflow: true,
                    hasOpenedWiki: false,
                    hasUsedChat: true,
                    settingsVisited: false,
                    dismissed: false,
                    hasCompletedTour: false,
                },
            });
            const result = appReducer(state, { type: 'COMPLETE_TOUR' });
            expect(result.onboardingProgress.hasRunWorkflow).toBe(true);
            expect(result.onboardingProgress.hasUsedChat).toBe(true);
            expect(result.onboardingProgress.hasCompletedTour).toBe(true);
        });

        it('does not perform persistence in the reducer', () => {
            const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
            vi.stubGlobal('fetch', fetchSpy);
            const state = makeState();
            appReducer(state, { type: 'COMPLETE_TOUR' });
            expect(fetchSpy).not.toHaveBeenCalled();
            vi.unstubAllGlobals();
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
