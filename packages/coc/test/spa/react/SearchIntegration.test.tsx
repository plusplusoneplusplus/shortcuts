/**
 * Tests for AppContext search reducer actions.
 */

import { describe, it, expect } from 'vitest';
import { appReducer, type AppContextState } from '../../../src/server/spa/client/react/contexts/AppContext';

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
        repoRouteState: {},
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
