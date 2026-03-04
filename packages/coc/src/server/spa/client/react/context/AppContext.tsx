/**
 * AppContext — centralised state for the processes/repos/wiki UI.
 * Replaces the global mutable appState singleton from state.ts.
 */

import { createContext, useContext, useReducer, useEffect, type ReactNode, type Dispatch } from 'react';
import type { DashboardTab, RepoSubTab, WikiViewMode, ConversationCacheEntry, WikiProjectTab, WikiAdminTab } from '../types/dashboard';
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
    selectedPipelineName: string | null;
    selectedChatSessionId: string | null;
    selectedGitCommitHash: string | null;
    conversationCache: Record<string, ConversationCacheEntry>;
    wsStatus: WsStatus;
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
    activeRepoSubTab: 'info',
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
    selectedPipelineName: null,
    selectedChatSessionId: null,
    selectedGitCommitHash: null,
    conversationCache: {},
    wsStatus: 'closed',
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
    | { type: 'SET_SELECTED_PIPELINE'; name: string | null }
    | { type: 'SET_SELECTED_CHAT_SESSION'; id: string | null }
    | { type: 'SET_GIT_COMMIT_HASH'; hash: string | null }
    | { type: 'SET_WS_STATUS'; status: WsStatus }
    | { type: 'SET_REPO_WIKI_ID'; wikiId: string | null }
    | { type: 'SET_REPO_WIKI_DEEP_LINK'; wikiId: string; tab?: WikiProjectTab | null; adminTab?: WikiAdminTab | null; componentId?: string | null }
    | { type: 'CLEAR_REPO_WIKI_INITIAL' };

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
        case 'SET_SELECTED_REPO':
            return { ...state, selectedRepoId: action.id };
        case 'SET_REPO_SUB_TAB':
            return { ...state, activeRepoSubTab: action.tab };
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
        case 'SET_SELECTED_PIPELINE':
            return { ...state, selectedPipelineName: action.name };
        case 'SET_SELECTED_CHAT_SESSION':
            return { ...state, selectedChatSessionId: action.id };
        case 'SET_GIT_COMMIT_HASH':
            return { ...state, selectedGitCommitHash: action.hash };
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
        default:
            return state;
    }
}

// ── Context ────────────────────────────────────────────────────────────

const AppContext = createContext<{ state: AppContextState; dispatch: Dispatch<AppAction> } | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(appReducer, initialState);

    // Sync sidebar collapsed state from server on mount + cross-tab sync
    useEffect(() => {
        let cancelled = false;
        fetch(getApiBase() + '/preferences')
            .then(r => r.json())
            .then((prefs) => {
                if (!cancelled && typeof prefs.reposSidebarCollapsed === 'boolean') {
                    dispatch({ type: 'SET_REPOS_SIDEBAR_COLLAPSED', value: prefs.reposSidebarCollapsed });
                    try { localStorage.setItem(SIDEBAR_KEY, String(prefs.reposSidebarCollapsed)); } catch { /* SSR / test */ }
                }
            })
            .catch(() => {});

        const onStorage = (e: StorageEvent) => {
            if (e.key === SIDEBAR_KEY && e.newValue !== null) {
                dispatch({ type: 'SET_REPOS_SIDEBAR_COLLAPSED', value: e.newValue === 'true' });
            }
        };
        window.addEventListener('storage', onStorage);
        return () => {
            cancelled = true;
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
