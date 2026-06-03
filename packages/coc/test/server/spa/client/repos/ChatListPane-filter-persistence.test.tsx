/**
 * @vitest-environment jsdom
 *
 * Reducer-level tests for the global `myWorkExcludedTypes` filter slice.
 *
 * The activity tab no longer renders a type-filter dropdown — chats and
 * automations are surfaced through the scope segmented control instead — so
 * the previous ChatListPane-level rendering tests for filter persistence are
 * gone. The reducer paths are still exercised here because `myWorkExcludedTypes`
 * is hydrated from server preferences via `SET_WELCOME_PREFERENCES` and read
 * (read-only) by `ChatListPane` to filter the running/queued/history lists.
 */
import { describe, it, expect } from 'vitest';
import { appReducer } from '../../../../../src/server/spa/client/react/contexts/AppContext';

// ---------------------------------------------------------------------------
// Tests — appReducer reducer slice for myWorkExcludedTypes
// ---------------------------------------------------------------------------

describe('appReducer – myWorkExcludedTypes', () => {
    const baseState = {
        processes: [],
        selectedId: null,
        workspace: '__all',
        statusFilter: '__all',
        typeFilter: '__all',
        myWorkExcludedTypes: [],
        searchQuery: '',
        searchResults: null,
        searchLoading: false,
        expandedGroups: {},
        activeTab: 'repos' as const,
        workspaces: [],
        selectedRepoId: null,
        activeRepoSubTab: 'copilot' as const,
        reposSidebarCollapsed: false,
        selectedWikiId: null,
        selectedWikiComponentId: null,
        wikiView: 'list' as const,
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
        selectedSkillTemplateId: null,
        selectedScriptTemplateId: null,
        selectedScheduleId: null,
        selectedGitCommitHash: null,
        selectedGitFilePath: null,
        selectedPrId: null,
        selectedPrDetailTab: null,
        selectedWorkflowProcessId: null,
        selectedExplorerPath: null,
        selectedNotePath: null,
        conversationCache: {},
        wsStatus: 'connecting' as const,
        activeMemorySubTab: 'bounded' as const,
        activeSkillsSubTab: 'installed' as const,
        activeAdminSubTab: 'storage' as const,
        adminDbTable: null,
        adminDbPage: 0,
        adminDbSort: null,
        adminDbOrder: null,
        repoTabState: {},
        notePathState: {},
        wikiTabState: {},
        repoSubTabNavState: {},
        settingsSection: 'info' as const,
        hasSeenWelcome: false,
        onboardingProgress: { hasRunWorkflow: false, hasOpenedWiki: false, hasUsedChat: false, settingsVisited: false, dismissed: false, hasCompletedTour: false },
        dismissedTips: [],
        preferencesLoaded: false,
    };

    it('SET_MY_WORK_EXCLUDED_TYPES updates the exclusion list', () => {
        const result = appReducer(baseState as any, { type: 'SET_MY_WORK_EXCLUDED_TYPES', value: ['chat', 'ask'] });
        expect(result.myWorkExcludedTypes).toEqual(['chat', 'ask']);
    });

    it('SET_MY_WORK_EXCLUDED_TYPES with empty array clears exclusions', () => {
        const state = { ...baseState, myWorkExcludedTypes: ['chat'] } as any;
        const result = appReducer(state, { type: 'SET_MY_WORK_EXCLUDED_TYPES', value: [] });
        expect(result.myWorkExcludedTypes).toEqual([]);
    });

    it('SET_WELCOME_PREFERENCES loads myWorkExcludedTypes from server', () => {
        const result = appReducer(baseState as any, {
            type: 'SET_WELCOME_PREFERENCES',
            payload: {
                activityFilters: { myWorkExcludedTypes: ['run-workflow', 'run-script'] },
            },
        });
        expect(result.myWorkExcludedTypes).toEqual(['run-workflow', 'run-script']);
        expect(result.preferencesLoaded).toBe(true);
    });

    it('SET_WELCOME_PREFERENCES without myWorkExcludedTypes preserves default', () => {
        const result = appReducer(baseState as any, {
            type: 'SET_WELCOME_PREFERENCES',
            payload: {
                activityFilters: { workspace: 'ws-1' },
            },
        });
        expect(result.myWorkExcludedTypes).toEqual([]);
        // statusFilter is no longer stored in global prefs; stays at default
        expect(result.statusFilter).toBe('__all');
    });

    it('SET_WELCOME_PREFERENCES without activityFilters preserves default', () => {
        const result = appReducer(baseState as any, {
            type: 'SET_WELCOME_PREFERENCES',
            payload: {},
        });
        expect(result.myWorkExcludedTypes).toEqual([]);
    });
});
