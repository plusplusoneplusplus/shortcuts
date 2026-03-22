/**
 * ChatPreferencesContext — centralised state for chat pin/archive preferences.
 * Replaces per-component useChatPreferences hook calls with a single shared
 * fetch and in-memory state, following the QueueContext pattern.
 */

import {
    createContext,
    useContext,
    useReducer,
    useEffect,
    useCallback,
    type ReactNode,
    type Dispatch,
} from 'react';
import { getWorkspacePreferences, patchWorkspacePreferences } from '../hooks/preferencesApi';

const MAX_PINNED = 50;
const MAX_ARCHIVED = 500;

// ── State ──────────────────────────────────────────────────────────────────

export interface ChatPrefsState {
    /** Ordered array of pinned task IDs (newest-first). Max MAX_PINNED entries. */
    pinnedIds: string[];
    /** Ordered array of archived task IDs (newest-first). Max MAX_ARCHIVED entries. */
    archivedIds: string[];
    /** True once the initial GET /preferences response has been processed. */
    loaded: boolean;
    /** The workspaceId currently loaded, stored here so useChatPrefs can access it. */
    workspaceId: string;
}

// ── Actions ────────────────────────────────────────────────────────────────

export type ChatPrefsAction =
    | { type: 'SET_ALL'; pinnedIds: string[]; archivedIds: string[]; workspaceId: string }
    | { type: 'PIN'; taskId: string }
    | { type: 'UNPIN'; taskId: string }
    | { type: 'ARCHIVE'; taskId: string }
    | { type: 'UNARCHIVE'; taskId: string }
    | { type: 'RESET' };

// ── Reducer ────────────────────────────────────────────────────────────────

export function chatPrefsReducer(
    state: ChatPrefsState,
    action: ChatPrefsAction,
): ChatPrefsState {
    switch (action.type) {
        case 'RESET':
            return { pinnedIds: [], archivedIds: [], loaded: false, workspaceId: '' };
        case 'SET_ALL':
            return {
                ...state,
                pinnedIds: action.pinnedIds,
                archivedIds: action.archivedIds,
                loaded: true,
                workspaceId: action.workspaceId,
            };
        case 'PIN':
            if (state.pinnedIds.includes(action.taskId)) return state;
            return { ...state, pinnedIds: [action.taskId, ...state.pinnedIds].slice(0, MAX_PINNED) };
        case 'UNPIN':
            if (!state.pinnedIds.includes(action.taskId)) return state;
            return { ...state, pinnedIds: state.pinnedIds.filter(id => id !== action.taskId) };
        case 'ARCHIVE':
            if (state.archivedIds.includes(action.taskId)) return state;
            return { ...state, archivedIds: [action.taskId, ...state.archivedIds].slice(0, MAX_ARCHIVED) };
        case 'UNARCHIVE':
            if (!state.archivedIds.includes(action.taskId)) return state;
            return { ...state, archivedIds: state.archivedIds.filter(id => id !== action.taskId) };
        default:
            return state;
    }
}

// ── Context ────────────────────────────────────────────────────────────────

const ChatPreferencesContext = createContext<{
    state: ChatPrefsState;
    dispatch: Dispatch<ChatPrefsAction>;
} | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────

export function ChatPreferencesProvider({
    workspaceId,
    children,
}: {
    workspaceId: string;
    children: ReactNode;
}) {
    const [state, dispatch] = useReducer(chatPrefsReducer, {
        pinnedIds: [],
        archivedIds: [],
        loaded: false,
        workspaceId: '',
    });

    useEffect(() => {
        dispatch({ type: 'RESET' });
        if (!workspaceId) return;

        let cancelled = false;
        getWorkspacePreferences(workspaceId)
            .then(prefs => {
                if (cancelled) return;
                const pinnedIds = prefs.pinnedChats?.[workspaceId] ?? [];
                const archivedIds = prefs.archivedChats?.[workspaceId] ?? [];
                dispatch({ type: 'SET_ALL', pinnedIds, archivedIds, workspaceId });
            })
            .catch(() => {
                if (!cancelled) dispatch({ type: 'SET_ALL', pinnedIds: [], archivedIds: [], workspaceId });
            });

        return () => { cancelled = true; };
    }, [workspaceId]);

    return (
        <ChatPreferencesContext.Provider value={{ state, dispatch }}>
            {children}
        </ChatPreferencesContext.Provider>
    );
}

// ── Consumer hook ──────────────────────────────────────────────────────────

export interface ChatPrefsAPI {
    pinnedChatIds: Set<string>;
    archivedChatIds: Set<string>;
    pinChat: (taskId: string) => void;
    unpinChat: (taskId: string) => void;
    archiveChat: (taskId: string) => void;
    unarchiveChat: (taskId: string) => void;
    loaded: boolean;
}

export function useChatPrefs(): ChatPrefsAPI {
    const ctx = useContext(ChatPreferencesContext);
    if (!ctx) throw new Error('useChatPrefs must be used within ChatPreferencesProvider');

    const { state, dispatch } = ctx;

    const pinChat = useCallback((taskId: string) => {
        if (state.pinnedIds.includes(taskId)) return;
        const nextIds = [taskId, ...state.pinnedIds].slice(0, MAX_PINNED);
        dispatch({ type: 'PIN', taskId });
        patchWorkspacePreferences(state.workspaceId, {
            pinnedChats: { [state.workspaceId]: nextIds },
        }).catch(() => {});
    }, [dispatch, state.pinnedIds, state.workspaceId]);

    const unpinChat = useCallback((taskId: string) => {
        if (!state.pinnedIds.includes(taskId)) return;
        const nextIds = state.pinnedIds.filter(id => id !== taskId);
        dispatch({ type: 'UNPIN', taskId });
        patchWorkspacePreferences(state.workspaceId, {
            pinnedChats: { [state.workspaceId]: nextIds },
        }).catch(() => {});
    }, [dispatch, state.pinnedIds, state.workspaceId]);

    const archiveChat = useCallback((taskId: string) => {
        if (state.archivedIds.includes(taskId)) return;
        const nextIds = [taskId, ...state.archivedIds].slice(0, MAX_ARCHIVED);
        dispatch({ type: 'ARCHIVE', taskId });
        patchWorkspacePreferences(state.workspaceId, {
            archivedChats: { [state.workspaceId]: nextIds },
        }).catch(() => {});
    }, [dispatch, state.archivedIds, state.workspaceId]);

    const unarchiveChat = useCallback((taskId: string) => {
        if (!state.archivedIds.includes(taskId)) return;
        const nextIds = state.archivedIds.filter(id => id !== taskId);
        dispatch({ type: 'UNARCHIVE', taskId });
        patchWorkspacePreferences(state.workspaceId, {
            archivedChats: { [state.workspaceId]: nextIds },
        }).catch(() => {});
    }, [dispatch, state.archivedIds, state.workspaceId]);

    return {
        pinnedChatIds: new Set(state.pinnedIds),
        archivedChatIds: new Set(state.archivedIds),
        pinChat,
        unpinChat,
        archiveChat,
        unarchiveChat,
        loaded: state.loaded,
    };
}
