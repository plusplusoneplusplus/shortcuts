/**
 * AppContext — centralised state for the processes/repos/wiki UI.
 * Replaces the global mutable appState singleton from state.ts.
 */

import { createContext, useContext, useReducer, useEffect, type ReactNode, type Dispatch } from 'react';
import type { DashboardTab, RepoSubTab, SettingsSection, WikiViewMode, ConversationCacheEntry, WikiProjectTab, WikiAdminTab, MemorySubTab, SkillsSubTab, AdminSubTab, PrDetailTab, TasksPanelNavState } from '../types/dashboard';
import type { WsStatus } from '../hooks/useWebSocket';
import { getApiBase } from '../utils/config';

// ── Sidebar persistence ────────────────────────────────────────────────

export const SIDEBAR_KEY = 'coc-repos-sidebar-collapsed';

export function getInitialSidebarCollapsed(): boolean {
    try {
        return localStorage.getItem(SIDEBAR_KEY) === 'true';
    } catch {
        return false;
    }
}

// ── State ──────────────────────────────────────────────────────────────

export interface OnboardingProgress {
    hasRunWorkflow: boolean;
    hasOpenedWiki: boolean;
    hasUsedChat: boolean;
    settingsVisited: boolean;
    dismissed: boolean;
}

export interface AppContextState {
    processes: any[];
    selectedId: string | null;
    workspace: string;
    statusFilter: string;
    searchQuery: string;
    expandedGroups: Record<string, boolean>;
    activeTab: DashboardTab;
    workspaces: any[];
    selectedRepoId: string | null;
    activeRepoSubTab: RepoSubTab;
    reposSidebarCollapsed: boolean;
    selectedWikiId: string | null;
    selectedWikiComponentId: string | null;
    wikiView: WikiViewMode;
    wikiDetailInitialTab: string | null;
    wikiDetailInitialAdminTab: string | null;
    wikiAutoGenerate: boolean;
    wikis: any[];
    selectedRepoWikiId: string | null;
    repoWikiInitialTab: WikiProjectTab | null;
    repoWikiInitialAdminTab: WikiAdminTab | null;
    repoWikiInitialComponentId: string | null;
    selectedWorkflowName: string | null;
    selectedWorkflowRunProcessId: string | null;
    selectedSkillTemplateId: string | null;
    selectedScriptTemplateId: string | null;
    selectedScheduleId: string | null;
    selectedGitCommitHash: string | null;
    selectedGitFilePath: string | null;
    selectedPrId: number | string | null;
    selectedPrDetailTab: PrDetailTab | null;
    selectedWorkflowProcessId: string | null;
    selectedExplorerPath: string | null;
    conversationCache: Record<string, ConversationCacheEntry>;
    wsStatus: WsStatus;
    activeMemorySubTab: MemorySubTab;
    activeSkillsSubTab: SkillsSubTab;
    activeAdminSubTab: AdminSubTab;
    /** Per-repo remembered sub-tab (in-memory only, resets on page refresh). */
    repoTabState: Record<string, RepoSubTab>;
    /** Per-wiki remembered project tab (in-memory only, resets on page refresh). */
    wikiTabState: Record<string, string>;
    /** Per-repo per-sub-tab navigation state, keyed by `${repoId}::${subTab}` (in-memory only). */
    repoSubTabNavState: Record<string, TasksPanelNavState>;
    /** Currently active section within the Settings tab (Info / Preferences / MCP / Skills / Instructions). */
    settingsSection: SettingsSection;
    hasSeenWelcome: boolean;
    onboardingProgress: OnboardingProgress;
    dismissedTips: string[];
    preferencesLoaded: boolean;
}

const initialState: AppContextState = {
    processes: [],
    selectedId: null,
    workspace: '__all',
    statusFilter: '__all',
    searchQuery: '',
    expandedGroups: {},
    activeTab: 'repos',
    workspaces: [],
    selectedRepoId: null,
    activeRepoSubTab: 'settings',
    reposSidebarCollapsed: getInitialSidebarCollapsed(),
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
    selectedSkillTemplateId: null,
    selectedScriptTemplateId: null,
    selectedScheduleId: null,
    selectedGitCommitHash: null,
    selectedGitFilePath: null,
    selectedPrId: null,
    selectedPrDetailTab: null,
    selectedWorkflowProcessId: null,
    selectedExplorerPath: null,
    conversationCache: {},
    wsStatus: 'closed',
    activeMemorySubTab: 'config',
    activeSkillsSubTab: 'installed',
    activeAdminSubTab: 'settings',
    repoTabState: {},
    wikiTabState: {},
    repoSubTabNavState: {},
    settingsSection: 'info',
    hasSeenWelcome: false,
    onboardingProgress: { hasRunWorkflow: false, hasOpenedWiki: false, hasUsedChat: false, settingsVisited: false, dismissed: false },
    dismissedTips: [],
    preferencesLoaded: false,
};

// ── Actions ────────────────────────────────────────────────────────────

const MAX_CACHE_ENTRIES = 50;
const CACHE_TTL_MS = 60 * 60 * 1000;

export type AppAction =
    | { type: 'PROCESS_ADDED'; process: any }
    | { type: 'PROCESS_UPDATED'; process: any }
    | { type: 'PROCESS_REMOVED'; processId: string }
    | { type: 'PROCESSES_CLEARED' }
    | { type: 'SET_PROCESSES'; processes: any[] }
    | { type: 'WORKSPACES_LOADED'; workspaces: any[] }
    | { type: 'WORKSPACE_REGISTERED'; workspace: any }
    | { type: 'SELECT_PROCESS'; id: string | null }
    | { type: 'SET_WORKSPACE_FILTER'; value: string }
    | { type: 'SET_STATUS_FILTER'; value: string }
    | { type: 'SET_SEARCH_QUERY'; value: string }
    | { type: 'SET_ACTIVE_TAB'; tab: DashboardTab }
    | { type: 'SET_SELECTED_REPO'; id: string | null }
    | { type: 'SET_REPO_SUB_TAB'; tab: RepoSubTab }
    | { type: 'TOGGLE_REPOS_SIDEBAR' }
    | { type: 'SET_REPOS_SIDEBAR_COLLAPSED'; value: boolean }
    | { type: 'SET_WIKI_VIEW'; wikiId: string | null; componentId: string | null; view: WikiViewMode }
    | { type: 'SET_WIKIS'; wikis: any[] }
    | { type: 'SELECT_WIKI'; wikiId: string | null }
    | { type: 'SELECT_WIKI_WITH_TAB'; wikiId: string; tab: string; adminTab?: string | null; componentId?: string | null }
    | { type: 'SELECT_WIKI_COMPONENT'; componentId: string | null }
    | { type: 'CLEAR_WIKI_INITIAL_TAB' }
    | { type: 'SET_WIKI_AUTO_GENERATE'; value: boolean }
    | { type: 'ADD_WIKI'; wiki: any }
    | { type: 'UPDATE_WIKI'; wiki: any }
    | { type: 'REMOVE_WIKI'; wikiId: string }
    | { type: 'WIKI_RELOAD'; wiki: any }
    | { type: 'WIKI_REBUILDING'; wikiId: string }
    | { type: 'WIKI_ERROR'; wikiId: string; error: string }
    | { type: 'TOGGLE_GROUP'; key: string }
    | { type: 'CACHE_CONVERSATION'; processId: string; turns: any[] }
    | { type: 'APPEND_TURN'; processId: string; turn: any }
    | { type: 'INVALIDATE_CONVERSATION'; processId: string }
    | { type: 'SET_SELECTED_WORKFLOW'; name: string | null }
    | { type: 'SET_WORKFLOW_RUN_PROCESS'; processId: string | null }
    | { type: 'SET_SELECTED_SKILL_TEMPLATE'; id: string | null }
    | { type: 'SET_SELECTED_SCRIPT_TEMPLATE'; id: string | null }
    | { type: 'SET_SELECTED_SCHEDULE'; id: string | null }
    | { type: 'SET_GIT_COMMIT_HASH'; hash: string | null }
    | { type: 'SET_GIT_FILE_PATH'; filePath: string }
    | { type: 'CLEAR_GIT_FILE_PATH' }
    | { type: 'SET_WORKFLOW_PROCESS'; processId: string | null }
    | { type: 'SET_WS_STATUS'; status: WsStatus }
    | { type: 'SET_REPO_WIKI_ID'; wikiId: string | null }
    | { type: 'SET_REPO_WIKI_DEEP_LINK'; wikiId: string; tab?: WikiProjectTab | null; adminTab?: WikiAdminTab | null; componentId?: string | null }
    | { type: 'CLEAR_REPO_WIKI_INITIAL' }
    | { type: 'SET_EXPLORER_PATH'; path: string | null }
    | { type: 'SET_MEMORY_SUB_TAB'; tab: MemorySubTab }
    | { type: 'SET_SKILLS_SUB_TAB'; tab: SkillsSubTab }
    | { type: 'SET_ADMIN_SUB_TAB'; tab: AdminSubTab }
    | { type: 'SET_WIKI_TAB'; wikiId: string; tab: string }
    | { type: 'SET_SELECTED_PR'; prId: number | string }
    | { type: 'SET_PR_DETAIL_TAB'; tab: PrDetailTab }
    | { type: 'CLEAR_SELECTED_PR' }
    | { type: 'SET_TASKS_NAV_STATE'; repoId: string; navState: TasksPanelNavState }
    | { type: 'SET_SETTINGS_SECTION'; section: SettingsSection }
    | { type: 'SET_WELCOME_PREFERENCES'; payload: { hasSeenWelcome?: boolean; onboardingProgress?: Partial<OnboardingProgress>; dismissedTips?: string[] } }
    | { type: 'DISMISS_WELCOME' }
    | { type: 'UPDATE_ONBOARDING'; payload: Partial<OnboardingProgress> }
    | { type: 'DISMISS_TIP'; payload: { tipId: string } };

// ── Reducer ────────────────────────────────────────────────────────────

export function appReducer(state: AppContextState, action: AppAction): AppContextState {
    switch (action.type) {
        case 'PROCESS_ADDED': {
            const exists = state.processes.some(p => p.id === action.process.id);
            if (exists) return state;
            return { ...state, processes: [...state.processes, action.process] };
        }
        case 'PROCESS_UPDATED': {
            const idx = state.processes.findIndex(p => p.id === action.process.id);
            if (idx < 0) return state;
            const updated = [...state.processes];
            updated[idx] = { ...updated[idx], ...action.process };
            return { ...state, processes: updated };
        }
        case 'PROCESS_REMOVED': {
            const filtered = state.processes.filter(p => p.id !== action.processId);
            const newSelectedId = state.selectedId === action.processId ? null : state.selectedId;
            return { ...state, processes: filtered, selectedId: newSelectedId };
        }
        case 'PROCESSES_CLEARED': {
            const remaining = state.processes.filter(p => p.status !== 'completed');
            const stillSelected = remaining.some(p => p.id === state.selectedId);
            return { ...state, processes: remaining, selectedId: stillSelected ? state.selectedId : null };
        }
        case 'SET_PROCESSES':
            return { ...state, processes: action.processes };
        case 'WORKSPACES_LOADED':
            return { ...state, workspaces: action.workspaces };
        case 'WORKSPACE_REGISTERED': {
            const exists = state.workspaces.some(w => w.id === action.workspace.id);
            if (exists) return state;
            return { ...state, workspaces: [...state.workspaces, action.workspace] };
        }
        case 'SELECT_PROCESS':
            return { ...state, selectedId: action.id };
        case 'SET_WORKSPACE_FILTER':
            return { ...state, workspace: action.value };
        case 'SET_STATUS_FILTER':
            return { ...state, statusFilter: action.value };
        case 'SET_SEARCH_QUERY':
            return { ...state, searchQuery: action.value };
        case 'SET_ACTIVE_TAB':
            return { ...state, activeTab: action.tab };
        case 'SET_SELECTED_REPO': {
            // Save current repo's active sub-tab before switching
            const savedTabState = state.selectedRepoId
                ? { ...state.repoTabState, [state.selectedRepoId]: state.activeRepoSubTab }
                : state.repoTabState;
            const restoredTab = action.id ? (savedTabState[action.id] ?? 'settings') : state.activeRepoSubTab;
            return { ...state, selectedRepoId: action.id, repoTabState: savedTabState, activeRepoSubTab: restoredTab, selectedWorkflowName: null, selectedWorkflowProcessId: null };
        }
        case 'SET_REPO_SUB_TAB': {
            const updatedRepoTabState = state.selectedRepoId
                ? { ...state.repoTabState, [state.selectedRepoId]: action.tab }
                : state.repoTabState;
            return { ...state, activeRepoSubTab: action.tab, repoTabState: updatedRepoTabState };
        }
        case 'TOGGLE_REPOS_SIDEBAR': {
            const next = !state.reposSidebarCollapsed;
            try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch { /* SSR / test */ }
            fetch(getApiBase() + '/preferences', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reposSidebarCollapsed: next }),
            }).catch(() => {});
            return { ...state, reposSidebarCollapsed: next };
        }
        case 'SET_REPOS_SIDEBAR_COLLAPSED':
            return state.reposSidebarCollapsed === action.value ? state : { ...state, reposSidebarCollapsed: action.value };
        case 'SET_WIKI_VIEW':
            return { ...state, selectedWikiId: action.wikiId, selectedWikiComponentId: action.componentId, wikiView: action.view };
        case 'SET_WIKIS':
            return { ...state, wikis: action.wikis };
        case 'SELECT_WIKI':
            return { ...state, selectedWikiId: action.wikiId, selectedWikiComponentId: null, wikiView: action.wikiId ? 'detail' : 'list', wikiDetailInitialTab: null, wikiDetailInitialAdminTab: null };
        case 'SELECT_WIKI_WITH_TAB':
            return { ...state, selectedWikiId: action.wikiId, selectedWikiComponentId: action.componentId ?? null, wikiView: 'detail', wikiDetailInitialTab: action.tab, wikiDetailInitialAdminTab: action.adminTab ?? null };
        case 'SELECT_WIKI_COMPONENT':
            return { ...state, selectedWikiComponentId: action.componentId };
        case 'CLEAR_WIKI_INITIAL_TAB':
            return { ...state, wikiDetailInitialTab: null, wikiDetailInitialAdminTab: null };
        case 'SET_WIKI_AUTO_GENERATE':
            return { ...state, wikiAutoGenerate: action.value };
        case 'ADD_WIKI':
            return { ...state, wikis: [...state.wikis, action.wiki] };
        case 'UPDATE_WIKI': {
            const idx = state.wikis.findIndex((w: any) => w.id === action.wiki.id);
            if (idx < 0) return state;
            const updated = [...state.wikis];
            updated[idx] = { ...updated[idx], ...action.wiki };
            return { ...state, wikis: updated };
        }
        case 'REMOVE_WIKI': {
            const filtered = state.wikis.filter((w: any) => w.id !== action.wikiId);
            const clearSelected = state.selectedWikiId === action.wikiId;
            return { ...state, wikis: filtered, ...(clearSelected ? { selectedWikiId: null, selectedWikiComponentId: null, wikiView: 'list' as WikiViewMode } : {}) };
        }
        case 'WIKI_RELOAD': {
            const idx = state.wikis.findIndex((w: any) => w.id === action.wiki?.id);
            if (idx < 0 && action.wiki) return { ...state, wikis: [...state.wikis, action.wiki] };
            if (idx < 0) return state;
            const updated = [...state.wikis];
            updated[idx] = { ...updated[idx], ...action.wiki };
            return { ...state, wikis: updated };
        }
        case 'WIKI_REBUILDING': {
            const idx = state.wikis.findIndex((w: any) => w.id === action.wikiId);
            if (idx < 0) return state;
            const updated = [...state.wikis];
            updated[idx] = { ...updated[idx], status: 'generating' };
            return { ...state, wikis: updated };
        }
        case 'WIKI_ERROR': {
            const idx = state.wikis.findIndex((w: any) => w.id === action.wikiId);
            if (idx < 0) return state;
            const updated = [...state.wikis];
            updated[idx] = { ...updated[idx], status: 'error', errorMessage: action.error };
            return { ...state, wikis: updated };
        }
        case 'TOGGLE_GROUP':
            return { ...state, expandedGroups: { ...state.expandedGroups, [action.key]: !state.expandedGroups[action.key] } };
        case 'CACHE_CONVERSATION': {
            const now = Date.now();
            const cache = { ...state.conversationCache };
            // Evict expired
            for (const key of Object.keys(cache)) {
                if (now - cache[key].cachedAt > CACHE_TTL_MS) delete cache[key];
            }
            // Evict oldest if over limit
            const keys = Object.keys(cache);
            if (keys.length >= MAX_CACHE_ENTRIES) {
                let oldestKey = keys[0];
                let oldestTime = cache[oldestKey].cachedAt;
                for (let i = 1; i < keys.length; i++) {
                    if (cache[keys[i]].cachedAt < oldestTime) {
                        oldestKey = keys[i];
                        oldestTime = cache[keys[i]].cachedAt;
                    }
                }
                delete cache[oldestKey];
            }
            cache[action.processId] = { turns: action.turns, cachedAt: now };
            return { ...state, conversationCache: cache };
        }
        case 'APPEND_TURN': {
            const entry = state.conversationCache[action.processId];
            if (!entry) return state;
            return {
                ...state,
                conversationCache: {
                    ...state.conversationCache,
                    [action.processId]: { ...entry, turns: [...entry.turns, action.turn] },
                },
            };
        }
        case 'INVALIDATE_CONVERSATION': {
            const cache = { ...state.conversationCache };
            delete cache[action.processId];
            return { ...state, conversationCache: cache };
        }
        case 'SET_SELECTED_WORKFLOW':
            return { ...state, selectedWorkflowName: action.name };
        case 'SET_WORKFLOW_RUN_PROCESS':
            return { ...state, selectedWorkflowRunProcessId: action.processId };
        case 'SET_SELECTED_SKILL_TEMPLATE':
            return { ...state, selectedSkillTemplateId: action.id };
        case 'SET_SELECTED_SCRIPT_TEMPLATE':
            return { ...state, selectedScriptTemplateId: action.id };
        case 'SET_SELECTED_SCHEDULE':
            return { ...state, selectedScheduleId: action.id };
        case 'SET_GIT_COMMIT_HASH':
            return { ...state, selectedGitCommitHash: action.hash };
        case 'SET_GIT_FILE_PATH':
            return { ...state, selectedGitFilePath: action.filePath };
        case 'CLEAR_GIT_FILE_PATH':
            return { ...state, selectedGitFilePath: null };
        case 'SET_WORKFLOW_PROCESS':
            return { ...state, selectedWorkflowProcessId: action.processId };
        case 'SET_WS_STATUS':
            return state.wsStatus === action.status ? state : { ...state, wsStatus: action.status };
        case 'SET_REPO_WIKI_ID':
            return { ...state, selectedRepoWikiId: action.wikiId };
        case 'SET_REPO_WIKI_DEEP_LINK':
            return {
                ...state,
                selectedRepoWikiId: action.wikiId,
                repoWikiInitialTab: action.tab ?? null,
                repoWikiInitialAdminTab: action.adminTab ?? null,
                repoWikiInitialComponentId: action.componentId ?? null,
            };
        case 'CLEAR_REPO_WIKI_INITIAL':
            return { ...state, repoWikiInitialTab: null, repoWikiInitialAdminTab: null, repoWikiInitialComponentId: null };
        case 'SET_EXPLORER_PATH':
            return { ...state, selectedExplorerPath: action.path };
        case 'SET_MEMORY_SUB_TAB':
            return { ...state, activeMemorySubTab: action.tab };
        case 'SET_SKILLS_SUB_TAB':
            return { ...state, activeSkillsSubTab: action.tab };
        case 'SET_ADMIN_SUB_TAB':
            return { ...state, activeAdminSubTab: action.tab };
        case 'SET_WIKI_TAB':
            return { ...state, wikiTabState: { ...state.wikiTabState, [action.wikiId]: action.tab } };
        case 'SET_SELECTED_PR':
            return { ...state, selectedPrId: action.prId };
        case 'SET_PR_DETAIL_TAB':
            return state.selectedPrDetailTab === action.tab ? state : { ...state, selectedPrDetailTab: action.tab };
        case 'CLEAR_SELECTED_PR':
            return { ...state, selectedPrId: null, selectedPrDetailTab: null };
        case 'SET_TASKS_NAV_STATE':
            return {
                ...state,
                repoSubTabNavState: {
                    ...state.repoSubTabNavState,
                    [`${action.repoId}::tasks`]: action.navState,
                },
            };
        case 'SET_SETTINGS_SECTION':
            return state.settingsSection === action.section ? state : { ...state, settingsSection: action.section };
        case 'SET_WELCOME_PREFERENCES': {
            const { hasSeenWelcome, onboardingProgress, dismissedTips } = action.payload;
            return {
                ...state,
                hasSeenWelcome: hasSeenWelcome ?? state.hasSeenWelcome,
                onboardingProgress: onboardingProgress
                    ? { ...state.onboardingProgress, ...onboardingProgress }
                    : state.onboardingProgress,
                dismissedTips: dismissedTips ?? state.dismissedTips,
                preferencesLoaded: true,
            };
        }
        case 'DISMISS_WELCOME': {
            fetch(getApiBase() + '/preferences', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hasSeenWelcome: true }),
            }).catch(() => {});
            return { ...state, hasSeenWelcome: true };
        }
        case 'UPDATE_ONBOARDING': {
            const merged = { ...state.onboardingProgress, ...action.payload };
            fetch(getApiBase() + '/preferences', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ onboardingProgress: merged }),
            }).catch(() => {});
            return { ...state, onboardingProgress: merged };
        }
        case 'DISMISS_TIP': {
            if (state.dismissedTips.includes(action.payload.tipId)) return state;
            const updated = [...state.dismissedTips, action.payload.tipId];
            fetch(getApiBase() + '/preferences', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dismissedTips: updated }),
            }).catch(() => {});
            return { ...state, dismissedTips: updated };
        }
        default:
            return state;
    }
}

// ── Context ────────────────────────────────────────────────────────────

const AppContext = createContext<{ state: AppContextState; dispatch: Dispatch<AppAction> } | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(appReducer, initialState);

    // Cross-tab sync for sidebar collapsed state
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === SIDEBAR_KEY && e.newValue !== null) {
                dispatch({ type: 'SET_REPOS_SIDEBAR_COLLAPSED', value: e.newValue === 'true' });
            }
        };
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export function useApp() {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error('useApp must be used within AppProvider');
    return ctx;
}
