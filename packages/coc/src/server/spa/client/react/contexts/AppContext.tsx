/**
 * AppContext — centralised state for the processes/repos/wiki UI.
 * Replaces the global mutable appState singleton from state.ts.
 */

import { createContext, useContext, useReducer, useEffect, useRef, type ReactNode, type Dispatch } from 'react';
import type { DashboardTab, RepoSubTab, SettingsSection, WikiViewMode, ConversationCacheEntry, WikiProjectTab, WikiAdminTab, MemorySubTab, SkillsSubTab, AdminSubTab, PrDetailTab, TasksPanelNavState } from '../types/dashboard';
import { REPO_SUB_TAB_VALUES } from '../types/dashboard';
import type { WsStatus } from '../hooks/useWebSocket';
import { getSpaCocClient } from '../api/cocClient';
import { isContainerMode, setCurrentAgentId } from '../utils/config';
import { isQueueProcessId, toTaskId } from '../utils/queue-process-id';

// ── Sidebar persistence ────────────────────────────────────────────────

export const SIDEBAR_KEY = 'coc-repos-sidebar-collapsed';

export function getInitialSidebarCollapsed(): boolean {
    try {
        return localStorage.getItem(SIDEBAR_KEY) === 'true';
    } catch {
        return false;
    }
}

// ── Per-repo sub-tab persistence ───────────────────────────────────────

export const REPO_TAB_STATE_KEY = 'coc-repo-tab-state';
export const REPO_ROUTE_STATE_KEY = 'coc-repo-route-state';

/** Set of valid sub-tab ids, used to drop unknown/stale values on hydrate. */
const VALID_REPO_SUB_TAB_SET: ReadonlySet<string> = new Set(REPO_SUB_TAB_VALUES);

function normalizeRepoRouteSuffix(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    if (!value.startsWith('/')) return null;
    const tab = value.slice(1).split('/')[0];
    if (!VALID_REPO_SUB_TAB_SET.has(tab)) return null;
    return value;
}

export function getRepoSubTabFromRouteSuffix(suffix: string | null | undefined): RepoSubTab | null {
    const normalized = normalizeRepoRouteSuffix(suffix);
    if (!normalized) return null;
    return normalized.slice(1).split('/')[0] as RepoSubTab;
}

/**
 * Read the persisted per-repo sub-tab map from localStorage. Values that are
 * not a currently-known sub-tab (e.g. a removed/renamed tab id) are silently
 * dropped so a stale entry can never wedge the UI. Any parse/access failure
 * (SSR, disabled storage, corrupt JSON) yields an empty map.
 */
export function getInitialRepoTabState(): Record<string, RepoSubTab> {
    try {
        const raw = localStorage.getItem(REPO_TAB_STATE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const result: Record<string, RepoSubTab> = {};
        for (const [repoId, tab] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof tab === 'string' && VALID_REPO_SUB_TAB_SET.has(tab)) {
                result[repoId] = tab as RepoSubTab;
            }
        }
        return result;
    } catch {
        return {};
    }
}

/** Persist the per-repo sub-tab map. Swallows failures (SSR / disabled storage). */
function persistRepoTabState(repoTabState: Record<string, RepoSubTab>): void {
    try {
        localStorage.setItem(REPO_TAB_STATE_KEY, JSON.stringify(repoTabState));
    } catch { /* SSR / test / quota */ }
}

export function getInitialRepoRouteState(): Record<string, string> {
    try {
        const raw = localStorage.getItem(REPO_ROUTE_STATE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const result: Record<string, string> = {};
        for (const [repoId, suffix] of Object.entries(parsed as Record<string, unknown>)) {
            const normalized = normalizeRepoRouteSuffix(suffix);
            if (normalized) result[repoId] = normalized;
        }
        return result;
    } catch {
        return {};
    }
}

function persistRepoRouteState(repoRouteState: Record<string, string>): void {
    try {
        localStorage.setItem(REPO_ROUTE_STATE_KEY, JSON.stringify(repoRouteState));
    } catch { /* SSR / test / quota */ }
}

// ── State ──────────────────────────────────────────────────────────────

export interface OnboardingProgress {
    hasRunWorkflow: boolean;
    hasOpenedWiki: boolean;
    hasUsedChat: boolean;
    settingsVisited: boolean;
    dismissed: boolean;
    hasCompletedTour: boolean;
}

export interface AppContextState {
    processes: any[];
    selectedId: string | null;
    workspace: string;
    statusFilter: string;
    typeFilter: string;
    /** Persisted My Work Activity type exclusion set. */
    myWorkExcludedTypes: string[];
    searchQuery: string;
    /** null = not searching; [] = no results found */
    searchResults: any[] | null;
    searchLoading: boolean;
    expandedGroups: Record<string, boolean>;
    activeTab: DashboardTab;
    workspaces: any[];
    selectedRepoId: string | null;
    currentAgentId: string | null;
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
    selectedNotePath: string | null;
    selectedWorkItemId: string | null;
    selectedWorkItemSessionTaskId: string | null;
    selectedWorkItemCommitHash: string | null;
    selectedWorkItemCommitFilePath: string | null;
    conversationCache: Record<string, ConversationCacheEntry>;
    wsStatus: WsStatus;
    activeMemorySubTab: MemorySubTab;
    /** Transient initial scope ID for the Memory workbench (set by deep-link from repo settings). */
    activeMemoryScopeId: string | null;
    activeSkillsSubTab: SkillsSubTab;
    activeAdminSubTab: AdminSubTab;
    adminDbTable: string | null;
    adminDbPage: number;
    adminDbSort: string | null;
    adminDbOrder: 'asc' | 'desc' | null;
    /** Per-repo remembered sub-tab, persisted locally and restored on workspace switch. */
    repoTabState: Record<string, RepoSubTab>;
    /** Per-repo remembered inner route suffix, persisted locally and restored on workspace switch. */
    repoRouteState: Record<string, string>;
    /** Per-workspace remembered note path (in-memory only, resets on page refresh). */
    notePathState: Record<string, string | null>;
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
    preferencesLoadFailed: boolean;
}

const initialState: AppContextState = {
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
    activeTab: 'repos',
    workspaces: [],
    selectedRepoId: null,
    currentAgentId: null,
    activeRepoSubTab: 'chats',
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
    selectedNotePath: null,
    selectedWorkItemId: null,
    selectedWorkItemSessionTaskId: null,
    selectedWorkItemCommitHash: null,
    selectedWorkItemCommitFilePath: null,
    conversationCache: {},
    wsStatus: 'closed',
    activeMemorySubTab: 'facts',
    activeMemoryScopeId: null,
    activeSkillsSubTab: 'installed',
    activeAdminSubTab: 'settings',
    adminDbTable: null,
    adminDbPage: 1,
    adminDbSort: null,
    adminDbOrder: null,
    repoTabState: getInitialRepoTabState(),
    repoRouteState: getInitialRepoRouteState(),
    notePathState: {},
    wikiTabState: {},
    repoSubTabNavState: {},
    settingsSection: 'info',
    hasSeenWelcome: false,
    onboardingProgress: { hasRunWorkflow: false, hasOpenedWiki: false, hasUsedChat: false, settingsVisited: false, dismissed: false, hasCompletedTour: false },
    dismissedTips: [],
    preferencesLoaded: false,
    preferencesLoadFailed: false,
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
    | { type: 'SET_TYPE_FILTER'; value: string }
    | { type: 'SET_SEARCH_QUERY'; value: string }
    | { type: 'SET_SEARCH_RESULTS'; results: any[] | null }
    | { type: 'SET_SEARCH_LOADING'; loading: boolean }
    | { type: 'SET_ACTIVE_TAB'; tab: DashboardTab }
    | { type: 'SET_SELECTED_REPO'; id: string | null }
    | { type: 'SET_CURRENT_AGENT'; agentId: string | null }
    | { type: 'SET_REPO_SUB_TAB'; tab: RepoSubTab }
    | { type: 'RECORD_REPO_ROUTE_SUFFIX'; repoId: string; suffix: string }
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
    | { type: 'SET_SELECTED_NOTE_PATH'; notePath: string | null }
    | { type: 'SET_WORK_ITEM_DEEP_LINK'; workItemId: string | null; sessionTaskId?: string | null; commitHash?: string | null; commitFilePath?: string | null }
    | { type: 'SET_MEMORY_SUB_TAB'; tab: MemorySubTab }
    | { type: 'SET_MEMORY_SCOPE'; scopeId: string | null }
    | { type: 'SET_SKILLS_SUB_TAB'; tab: SkillsSubTab }
    | { type: 'SET_ADMIN_SUB_TAB'; tab: AdminSubTab }
    | { type: 'SET_ADMIN_DB_DEEP_LINK'; table: string | null; page: number; sort: string | null; order: 'asc' | 'desc' | null }
    | { type: 'SET_WIKI_TAB'; wikiId: string; tab: string }
    | { type: 'SET_SELECTED_PR'; prId: number | string }
    | { type: 'SET_PR_DETAIL_TAB'; tab: PrDetailTab }
    | { type: 'CLEAR_SELECTED_PR' }
    | { type: 'SET_TASKS_NAV_STATE'; repoId: string; navState: TasksPanelNavState }
    | { type: 'SET_SETTINGS_SECTION'; section: SettingsSection }
    | { type: 'SET_WELCOME_PREFERENCES'; payload: { hasSeenWelcome?: boolean; onboardingProgress?: Partial<OnboardingProgress>; dismissedTips?: string[]; activityFilters?: { workspace?: string; myWorkExcludedTypes?: string[] } } }
    | { type: 'SET_PREFERENCES_LOAD_FAILED' }
    | { type: 'DISMISS_WELCOME' }
    | { type: 'UPDATE_ONBOARDING'; payload: Partial<OnboardingProgress> }
    | { type: 'DISMISS_TIP'; payload: { tipId: string } }
    | { type: 'COMPLETE_TOUR' }
    | { type: 'SET_MY_WORK_EXCLUDED_TYPES'; value: string[] }
    | { type: 'SET_REPO_FILTERS'; statusFilter: string; typeFilter: string };

// ── Reducer ────────────────────────────────────────────────────────────

function areTasksPanelNavStatesEqual(a: TasksPanelNavState | undefined, b: TasksPanelNavState): boolean {
    if (!a) return false;
    if (a.openFilePath !== b.openFilePath) return false;
    if (a.selectedFolderPath !== b.selectedFolderPath) return false;
    if (a.activeFolderPath !== b.activeFolderPath) return false;
    if (a.selectedFilePaths.length !== b.selectedFilePaths.length) return false;
    return a.selectedFilePaths.every((path, index) => path === b.selectedFilePaths[index]);
}

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
        case 'SET_TYPE_FILTER':
            return { ...state, typeFilter: action.value };
        case 'SET_MY_WORK_EXCLUDED_TYPES':
            return { ...state, myWorkExcludedTypes: action.value };
        case 'SET_REPO_FILTERS':
            return { ...state, statusFilter: action.statusFilter, typeFilter: action.typeFilter };
        case 'SET_SEARCH_QUERY': {
            const next: AppContextState = { ...state, searchQuery: action.value };
            // Clear search results when query is emptied
            if (!action.value) {
                next.searchResults = null;
                next.searchLoading = false;
            }
            return next;
        }
        case 'SET_SEARCH_RESULTS':
            return { ...state, searchResults: action.results };
        case 'SET_SEARCH_LOADING':
            return { ...state, searchLoading: action.loading };
        case 'SET_ACTIVE_TAB': {
            const newState = { ...state, activeTab: action.tab };
            if (action.tab === 'wiki' && !state.onboardingProgress.hasOpenedWiki) {
                const merged = { ...state.onboardingProgress, hasOpenedWiki: true };
                return { ...newState, onboardingProgress: merged };
            }
            return newState;
        }
        case 'SET_SELECTED_REPO': {
            // Save current repo's active sub-tab before switching
            const savedTabState = state.selectedRepoId
                ? { ...state.repoTabState, [state.selectedRepoId]: state.activeRepoSubTab }
                : state.repoTabState;
            const restoredRouteTab = action.id ? getRepoSubTabFromRouteSuffix(state.repoRouteState?.[action.id]) : null;
            const restoredTab = action.id ? (restoredRouteTab ?? savedTabState[action.id] ?? 'chats') : state.activeRepoSubTab;
            // Save + restore note path per workspace
            const savedNoteState = state.selectedRepoId
                ? { ...state.notePathState, [state.selectedRepoId]: state.selectedNotePath }
                : state.notePathState;
            const restoredNotePath = action.id ? (savedNoteState[action.id] ?? null) : null;
            if (savedTabState !== state.repoTabState) persistRepoTabState(savedTabState);
            return { ...state, selectedRepoId: action.id, repoTabState: savedTabState, activeRepoSubTab: restoredTab, notePathState: savedNoteState, selectedNotePath: restoredNotePath, selectedWorkflowName: null, selectedWorkflowProcessId: null };
        }
        case 'SET_CURRENT_AGENT': {
            setCurrentAgentId(action.agentId);
            return { ...state, currentAgentId: action.agentId };
        }
        case 'SET_REPO_SUB_TAB': {
            const updatedRepoTabState = state.selectedRepoId
                ? { ...state.repoTabState, [state.selectedRepoId]: action.tab }
                : state.repoTabState;
            if (updatedRepoTabState !== state.repoTabState) persistRepoTabState(updatedRepoTabState);
            return { ...state, activeRepoSubTab: action.tab, repoTabState: updatedRepoTabState };
        }
        case 'RECORD_REPO_ROUTE_SUFFIX': {
            const suffix = normalizeRepoRouteSuffix(action.suffix);
            const tab = getRepoSubTabFromRouteSuffix(suffix);
            if (!suffix || !tab) return state;
            const currentRouteState = state.repoRouteState ?? {};
            const currentTabState = state.repoTabState ?? {};
            const updatedRouteState = currentRouteState[action.repoId] === suffix
                ? currentRouteState
                : { ...currentRouteState, [action.repoId]: suffix };
            const updatedTabState = currentTabState[action.repoId] === tab
                ? currentTabState
                : { ...currentTabState, [action.repoId]: tab };
            if (updatedRouteState !== currentRouteState) persistRepoRouteState(updatedRouteState);
            if (updatedTabState !== currentTabState) persistRepoTabState(updatedTabState);
            if (updatedRouteState === state.repoRouteState && updatedTabState === state.repoTabState) return state;
            return { ...state, repoRouteState: updatedRouteState, repoTabState: updatedTabState };
        }
        case 'TOGGLE_REPOS_SIDEBAR': {
            const next = !state.reposSidebarCollapsed;
            try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch { /* SSR / test */ }
            getSpaCocClient().preferences.patchGlobal({ reposSidebarCollapsed: next }).catch(() => {});
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
            if (isQueueProcessId(action.processId)) {
                delete cache[toTaskId(action.processId)];
            }
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
        case 'SET_SELECTED_NOTE_PATH': {
            if (state.selectedNotePath === action.notePath) return state;
            const updatedNoteState = state.selectedRepoId
                ? { ...state.notePathState, [state.selectedRepoId]: action.notePath }
                : state.notePathState;
            return { ...state, selectedNotePath: action.notePath, notePathState: updatedNoteState };
        }
        case 'SET_WORK_ITEM_DEEP_LINK':
            return {
                ...state,
                selectedWorkItemId: action.workItemId,
                selectedWorkItemSessionTaskId: action.sessionTaskId ?? null,
                selectedWorkItemCommitHash: action.commitHash ?? null,
                selectedWorkItemCommitFilePath: action.commitFilePath ?? null,
            };
        case 'SET_MEMORY_SUB_TAB':
            return { ...state, activeMemorySubTab: action.tab };
        case 'SET_MEMORY_SCOPE':
            return { ...state, activeMemoryScopeId: action.scopeId };
        case 'SET_SKILLS_SUB_TAB':
            return { ...state, activeSkillsSubTab: action.tab };
        case 'SET_ADMIN_SUB_TAB':
            return { ...state, activeAdminSubTab: action.tab };
        case 'SET_ADMIN_DB_DEEP_LINK':
            return { ...state, adminDbTable: action.table, adminDbPage: action.page, adminDbSort: action.sort, adminDbOrder: action.order };
        case 'SET_WIKI_TAB':
            return { ...state, wikiTabState: { ...state.wikiTabState, [action.wikiId]: action.tab } };
        case 'SET_SELECTED_PR':
            return { ...state, selectedPrId: action.prId };
        case 'SET_PR_DETAIL_TAB':
            return state.selectedPrDetailTab === action.tab ? state : { ...state, selectedPrDetailTab: action.tab };
        case 'CLEAR_SELECTED_PR':
            return { ...state, selectedPrId: null, selectedPrDetailTab: null };
        case 'SET_TASKS_NAV_STATE': {
            const key = `${action.repoId}::tasks`;
            if (areTasksPanelNavStatesEqual(state.repoSubTabNavState[key], action.navState)) {
                return state;
            }
            return {
                ...state,
                repoSubTabNavState: {
                    ...state.repoSubTabNavState,
                    [key]: action.navState,
                },
            };
        }
        case 'SET_SETTINGS_SECTION':
            return state.settingsSection === action.section ? state : { ...state, settingsSection: action.section };
        case 'SET_WELCOME_PREFERENCES': {
            const { hasSeenWelcome, onboardingProgress, dismissedTips, activityFilters } = action.payload;
            return {
                ...state,
                hasSeenWelcome: hasSeenWelcome ?? state.hasSeenWelcome,
                onboardingProgress: onboardingProgress
                    ? { ...state.onboardingProgress, ...onboardingProgress }
                    : state.onboardingProgress,
                dismissedTips: dismissedTips ?? state.dismissedTips,
                workspace: activityFilters?.workspace ?? state.workspace,
                myWorkExcludedTypes: activityFilters?.myWorkExcludedTypes ?? state.myWorkExcludedTypes,
                preferencesLoaded: true,
                preferencesLoadFailed: false,
            };
        }
        case 'SET_PREFERENCES_LOAD_FAILED':
            return { ...state, preferencesLoaded: true, preferencesLoadFailed: true };
        case 'DISMISS_WELCOME': {
            return { ...state, hasSeenWelcome: true };
        }
        case 'UPDATE_ONBOARDING': {
            const merged = { ...state.onboardingProgress, ...action.payload };
            return { ...state, onboardingProgress: merged };
        }
        case 'DISMISS_TIP': {
            if (state.dismissedTips.includes(action.payload.tipId)) return state;
            const updated = [...state.dismissedTips, action.payload.tipId];
            return { ...state, dismissedTips: updated };
        }
        case 'COMPLETE_TOUR': {
            const merged = { ...state.onboardingProgress, hasCompletedTour: true };
            return { ...state, onboardingProgress: merged };
        }
        default:
            return state;
    }
}

// ── Context ────────────────────────────────────────────────────────────

const AppContext = createContext<{ state: AppContextState; dispatch: Dispatch<AppAction> } | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(appReducer, initialState);

    // In container mode, update the global agent ID whenever the selected workspace changes.
    // This makes getApiBase() return the agent-prefixed path for all API calls.
    useEffect(() => {
        if (!isContainerMode()) return;
        if (!state.selectedRepoId) {
            if (state.currentAgentId !== null) {
                dispatch({ type: 'SET_CURRENT_AGENT', agentId: null });
            }
            return;
        }
        const matches = state.workspaces.filter((w: any) => w.id === state.selectedRepoId);
        let resolvedAgentId: string | null;
        if (matches.length === 0) {
            resolvedAgentId = null;
        } else if (matches.length === 1) {
            resolvedAgentId = matches[0].agentId ?? null;
        } else {
            // Multiple agents have the same workspace ID (same repo path).
            // Prefer the one matching the current agent (set explicitly by click handler).
            const preferred = matches.find((w: any) => w.agentId === state.currentAgentId);
            resolvedAgentId = (preferred ?? matches[0]).agentId ?? null;
        }
        if (resolvedAgentId !== state.currentAgentId) {
            dispatch({ type: 'SET_CURRENT_AGENT', agentId: resolvedAgentId });
        }
    }, [state.selectedRepoId, state.workspaces, state.currentAgentId]);

    // Debounced save of activity filters to server preferences
    const filterSaveRef = useRef<ReturnType<typeof setTimeout>>();
    const prevRepoFiltersRef = useRef({ workspace: state.workspace, statusFilter: state.statusFilter, typeFilter: state.typeFilter });
    // Tracks the last filter values loaded from the server for a given workspace (to avoid write-back loop)
    const justLoadedFiltersRef = useRef<{ workspace: string; statusFilter: string; typeFilter: string } | null>(null);

    // Load per-repo statusFilter/typeFilter when workspace changes
    useEffect(() => {
        if (!state.preferencesLoaded) return;
        if (state.workspace === '__all') {
            // Reset to defaults; no persistent state for cross-repo view
            const defaults = { workspace: '__all', statusFilter: '__all', typeFilter: '__all' };
            justLoadedFiltersRef.current = defaults;
            dispatch({ type: 'SET_REPO_FILTERS', statusFilter: '__all', typeFilter: '__all' });
            return;
        }
        const wsId = state.workspace;
        getSpaCocClient().preferences.getRepo(wsId)
            .then((prefs: any) => {
                const sf: string = prefs.activityFilters?.statusFilter ?? '__all';
                const tf: string = prefs.activityFilters?.typeFilter ?? '__all';
                justLoadedFiltersRef.current = { workspace: wsId, statusFilter: sf, typeFilter: tf };
                dispatch({ type: 'SET_REPO_FILTERS', statusFilter: sf, typeFilter: tf });
            })
            .catch(() => {});
    }, [state.workspace, state.preferencesLoaded]);

    // Debounced save of statusFilter/typeFilter to per-repo preferences
    useEffect(() => {
        if (!state.preferencesLoaded) return;
        if (state.workspace === '__all') return; // Not persisted for cross-repo view

        // Don't write back values that were just loaded from the server
        const loaded = justLoadedFiltersRef.current;
        if (loaded && loaded.workspace === state.workspace && loaded.statusFilter === state.statusFilter && loaded.typeFilter === state.typeFilter) {
            prevRepoFiltersRef.current = { workspace: state.workspace, statusFilter: state.statusFilter, typeFilter: state.typeFilter };
            return;
        }

        const prev = prevRepoFiltersRef.current;
        const cur = { workspace: state.workspace, statusFilter: state.statusFilter, typeFilter: state.typeFilter };
        if (prev.workspace === cur.workspace && prev.statusFilter === cur.statusFilter && prev.typeFilter === cur.typeFilter) return;
        prevRepoFiltersRef.current = cur;

        if (filterSaveRef.current) clearTimeout(filterSaveRef.current);
        filterSaveRef.current = setTimeout(() => {
            getSpaCocClient().preferences.patchRepo(state.workspace, { activityFilters: { statusFilter: state.statusFilter, typeFilter: state.typeFilter } } as any).catch(() => {});
        }, 500);

        return () => { if (filterSaveRef.current) clearTimeout(filterSaveRef.current); };
    }, [state.statusFilter, state.typeFilter, state.workspace, state.preferencesLoaded]);

    // Debounced save of selected workspace to global preferences
    const workspaceSaveRef = useRef<ReturnType<typeof setTimeout>>();
    const prevWorkspaceRef = useRef(state.workspace);
    useEffect(() => {
        if (!state.preferencesLoaded) return;
        if (prevWorkspaceRef.current === state.workspace) return;
        prevWorkspaceRef.current = state.workspace;

        if (workspaceSaveRef.current) clearTimeout(workspaceSaveRef.current);
        workspaceSaveRef.current = setTimeout(() => {
            getSpaCocClient().preferences.patchGlobal({ activityFilters: { workspace: state.workspace } } as any).catch(() => {});
        }, 500);

        return () => { if (workspaceSaveRef.current) clearTimeout(workspaceSaveRef.current); };
    }, [state.workspace, state.preferencesLoaded]);

    // Debounced save of myWorkExcludedTypes to server preferences
    const myWorkFilterSaveRef = useRef<ReturnType<typeof setTimeout>>();
    const prevMyWorkRef = useRef(state.myWorkExcludedTypes);

    useEffect(() => {
        if (!state.preferencesLoaded) return;

        const prev = prevMyWorkRef.current;
        const cur = state.myWorkExcludedTypes;
        if (prev.length === cur.length && prev.every((v, i) => v === cur[i])) return;
        prevMyWorkRef.current = cur;

        if (myWorkFilterSaveRef.current) clearTimeout(myWorkFilterSaveRef.current);
        myWorkFilterSaveRef.current = setTimeout(() => {
            getSpaCocClient().preferences.patchGlobal({ activityFilters: { myWorkExcludedTypes: cur } } as any).catch(() => {});
        }, 500);

        return () => { if (myWorkFilterSaveRef.current) clearTimeout(myWorkFilterSaveRef.current); };
    }, [state.myWorkExcludedTypes, state.preferencesLoaded]);

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
