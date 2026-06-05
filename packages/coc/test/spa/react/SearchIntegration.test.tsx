/**
 * Tests for SPA search integration — search results rendering, click navigation,
 * clear search, loading state, and AppContext search reducer actions.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp, appReducer, type AppContextState, type AppAction, type OnboardingProgress } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ProcessesSidebar } from '../../../src/server/spa/client/react/processes/ProcessesSidebar';

// Portal passthrough
vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../src/server/spa/client/react/tasks/comments/ContextMenu', () => ({
    ContextMenu: ({ items, onClose }: any) => (
        <div data-testid="context-menu">
            {items.filter((i: any) => !i.separator).map((item: any, idx: number) => (
                <button key={idx} onClick={() => { item.onClick(); onClose(); }}>{item.icon} {item.label}</button>
            ))}
        </div>
    ),
}));

vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/ui/useLongPress', () => ({
    useLongPress: () => ({
        onTouchStart: vi.fn(),
        onTouchEnd: vi.fn(),
        onTouchMove: vi.fn(),
        didLongPress: () => false,
    }),
}));

vi.mock('../../../src/server/spa/client/react/utils/workspace', () => ({
    resolveWorkspaceName: (id: string) => id,
    getProcessWorkspaceId: () => undefined,
    getProcessWorkspaceName: () => undefined,
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    isSessionContextAttachmentsEnabled: () => false,
}));

// ── State helpers ──────────────────────────────────────────────────────

function makeState(overrides: Partial<AppContextState> = {}): AppContextState {
    return {
        processes: [],
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
        conversationCache: {},
        wsStatus: 'closed',
        activeMemorySubTab: 'bounded',
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

function makeStats(overrides: Partial<{
    queued: number; running: number;
    total: number; isPaused: boolean; isDraining: boolean;
}> = {}) {
    return {
        queued: 0, running: 0,
        total: 0, isPaused: false, isDraining: false,
        ...overrides,
    };
}

function QueueSeeder({ stats, queued = [], running = [], history = [] }: {
    stats: ReturnType<typeof makeStats>;
    queued?: any[];
    running?: any[];
    history?: any[];
}) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'QUEUE_LOADED', queue: { queued, running, history, stats } });
    }, []);
    return null;
}

function AppSeeder({ actions }: { actions: AppAction[] }) {
    const { dispatch } = useApp();
    useEffect(() => {
        actions.forEach(a => dispatch(a));
    }, []);
    return null;
}

function renderSidebar(opts: { appActions?: AppAction[]; stats?: ReturnType<typeof makeStats>; queued?: any[]; running?: any[]; history?: any[] } = {}) {
    const { appActions = [], stats = makeStats(), queued = [], running = [], history = [] } = opts;
    return render(
        <AppProvider>
            <QueueProvider>
                <AppSeeder actions={appActions} />
                <QueueSeeder stats={stats} queued={queued} running={running} history={history} />
                <ProcessesSidebar />
            </QueueProvider>
        </AppProvider>
    );
}

// ── Reducer tests ──────────────────────────────────────────────────────

describe('AppContext reducer — search actions', () => {
    it('SET_SEARCH_RESULTS sets searchResults', () => {
        const state = makeState();
        const results = [{ processId: 'p1', turnIndex: 0, role: 'user', snippet: 'test', rank: -1 }];
        const next = appReducer(state, { type: 'SET_SEARCH_RESULTS', results });
        expect(next.searchResults).toBe(results);
    });

    it('SET_SEARCH_RESULTS can set null', () => {
        const state = makeState({ searchResults: [{ processId: 'p1' }] });
        const next = appReducer(state, { type: 'SET_SEARCH_RESULTS', results: null });
        expect(next.searchResults).toBe(null);
    });

    it('SET_SEARCH_LOADING sets searchLoading', () => {
        const state = makeState({ searchLoading: false });
        const next = appReducer(state, { type: 'SET_SEARCH_LOADING', loading: true });
        expect(next.searchLoading).toBe(true);
    });

    it('SET_SEARCH_QUERY clears searchResults when value is empty', () => {
        const state = makeState({ searchQuery: 'test', searchResults: [{ processId: 'p1' }], searchLoading: true });
        const next = appReducer(state, { type: 'SET_SEARCH_QUERY', value: '' });
        expect(next.searchQuery).toBe('');
        expect(next.searchResults).toBe(null);
        expect(next.searchLoading).toBe(false);
    });

    it('SET_SEARCH_QUERY preserves searchResults when value is non-empty', () => {
        const results = [{ processId: 'p1' }];
        const state = makeState({ searchQuery: 'te', searchResults: results });
        const next = appReducer(state, { type: 'SET_SEARCH_QUERY', value: 'tes' });
        expect(next.searchQuery).toBe('tes');
        expect(next.searchResults).toBe(results);
    });
});

// ── Search results rendering ───────────────────────────────────────────

describe('ProcessesSidebar — search results view', () => {
    const searchResults = [
        { processId: 'p1', turnIndex: 0, role: 'user', snippet: 'hello <mark>world</mark>', rank: -2.0, processTitle: 'My Process', promptPreview: 'greetings', processStatus: 'completed', processType: 'chat', workspaceId: 'ws1', startTime: '2024-01-01' },
        { processId: 'p1', turnIndex: 1, role: 'assistant', snippet: 'the <mark>world</mark> is vast', rank: -1.5, processTitle: 'My Process', promptPreview: 'greetings', processStatus: 'completed', processType: 'chat', workspaceId: 'ws1', startTime: '2024-01-01' },
        { processId: 'p2', turnIndex: 3, role: 'user', snippet: 'another <mark>world</mark>', rank: -1.0, processTitle: undefined, promptPreview: 'second prompt', processStatus: 'running', processType: 'chat', workspaceId: 'ws1', startTime: '2024-01-02' },
    ];

    it('renders search results view when searchResults is non-null', () => {
        renderSidebar({
            appActions: [
                { type: 'SET_SEARCH_RESULTS', results: searchResults },
            ],
        });
        expect(screen.getByTestId('search-results-view')).toBeTruthy();
    });

    it('shows results count header', () => {
        renderSidebar({
            appActions: [
                { type: 'SET_SEARCH_RESULTS', results: searchResults },
            ],
        });
        expect(screen.getByTestId('search-results-count').textContent).toContain('3 results');
        expect(screen.getByTestId('search-results-count').textContent).toContain('2 processes');
    });

    it('groups results by process — renders one card per process', () => {
        renderSidebar({
            appActions: [
                { type: 'SET_SEARCH_RESULTS', results: searchResults },
            ],
        });
        const cards = screen.getAllByTestId('search-result-card');
        expect(cards).toHaveLength(2);
    });

    it('renders highlighted snippets with <mark> tags', () => {
        renderSidebar({
            appActions: [
                { type: 'SET_SEARCH_RESULTS', results: searchResults },
            ],
        });
        const snippets = screen.getAllByTestId('search-result-snippet');
        expect(snippets).toHaveLength(3);
        // Check that <mark> is rendered in the DOM
        const markElements = snippets[0].querySelectorAll('mark');
        expect(markElements.length).toBeGreaterThanOrEqual(1);
        expect(markElements[0].textContent).toBe('world');
    });

    it('shows role badge for each snippet', () => {
        renderSidebar({
            appActions: [
                { type: 'SET_SEARCH_RESULTS', results: searchResults },
            ],
        });
        const snippets = screen.getAllByTestId('search-result-snippet');
        expect(snippets[0].textContent).toContain('user');
        expect(snippets[1].textContent).toContain('assistant');
    });

    it('clicking a search result navigates to the process', () => {
        const originalHash = location.hash;
        renderSidebar({
            appActions: [
                { type: 'SET_SEARCH_RESULTS', results: searchResults },
            ],
        });
        const cards = screen.getAllByTestId('search-result-card');
        fireEvent.click(cards[0]);
        expect(location.hash).toBe('#process/p1');
        location.hash = originalHash;
    });

    it('shows loading state when searchLoading is true', () => {
        renderSidebar({
            appActions: [
                { type: 'SET_SEARCH_RESULTS', results: [] },
                { type: 'SET_SEARCH_LOADING', loading: true },
            ],
        });
        expect(screen.getByTestId('search-results-loading')).toBeTruthy();
        expect(screen.getByTestId('search-results-loading').textContent).toContain('Searching');
    });

    it('shows "No results found" for empty results array', () => {
        renderSidebar({
            appActions: [
                { type: 'SET_SEARCH_RESULTS', results: [] },
            ],
        });
        expect(screen.getByTestId('search-no-results')).toBeTruthy();
    });

    it('does NOT render search results view when searchResults is null', () => {
        renderSidebar({
            appActions: [],
        });
        expect(screen.queryByTestId('search-results-view')).toBeFalsy();
    });

    it('uses promptPreview when processTitle is missing', () => {
        renderSidebar({
            appActions: [
                { type: 'SET_SEARCH_RESULTS', results: [searchResults[2]] },
            ],
        });
        const card = screen.getByTestId('search-result-card');
        expect(card.textContent).toContain('second prompt');
    });

    it('renders normal process list when searchResults is null (does not break existing behavior)', () => {
        renderSidebar({
            appActions: [],
            stats: makeStats(),
        });
        // Should show the empty state or normal list, not search results
        expect(screen.queryByTestId('search-results-view')).toBeFalsy();
        expect(screen.getByText('No processes yet')).toBeTruthy();
    });
});
