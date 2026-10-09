/**
 * ChatPreferencesContext — centralised state for chat pin/archive preferences.
 * Pin/archive state is stored on each process row in SQLite and toggled via
 * dedicated REST endpoints, not through the preferences file.
 */

import {
    useReducer,
    useEffect,
    useRef,
    type ReactNode,
} from 'react';
import { ChatPreferencesContext, useChatPrefs } from './chatPrefsConsumer';

export { useChatPrefs, useOptionalChatPrefs, type ChatPrefsAPI } from './chatPrefsConsumer';

const MAX_PINNED = 50;
const MAX_ARCHIVED = 500;

// ── State ──────────────────────────────────────────────────────────────────

export interface ChatPrefsState {
    /** Ordered array of pinned task IDs (newest-first). Max MAX_PINNED entries. */
    pinnedIds: string[];
    /** Ordered array of archived task IDs (newest-first). Max MAX_ARCHIVED entries. */
    archivedIds: string[];
    /** True once the initial process data has been processed. */
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
    | { type: 'ARCHIVE_MANY'; taskIds: string[] }
    | { type: 'UNARCHIVE_MANY'; taskIds: string[] }
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
        case 'PIN': {
            if (state.pinnedIds.includes(action.taskId)) return state;
            const nextPinned = [action.taskId, ...state.pinnedIds].slice(0, MAX_PINNED);
            // Auto-unarchive: a pinned chat should always be visible
            const wasArchived = state.archivedIds.includes(action.taskId);
            return {
                ...state,
                pinnedIds: nextPinned,
                archivedIds: wasArchived
                    ? state.archivedIds.filter(id => id !== action.taskId)
                    : state.archivedIds,
            };
        }
        case 'UNPIN':
            if (!state.pinnedIds.includes(action.taskId)) return state;
            return { ...state, pinnedIds: state.pinnedIds.filter(id => id !== action.taskId) };
        case 'ARCHIVE':
            if (state.archivedIds.includes(action.taskId)) return state;
            return { ...state, archivedIds: [action.taskId, ...state.archivedIds].slice(0, MAX_ARCHIVED) };
        case 'UNARCHIVE':
            if (!state.archivedIds.includes(action.taskId)) return state;
            return { ...state, archivedIds: state.archivedIds.filter(id => id !== action.taskId) };
        case 'ARCHIVE_MANY': {
            const toAdd = action.taskIds.filter(id => !state.archivedIds.includes(id));
            if (toAdd.length === 0) return state;
            return { ...state, archivedIds: [...toAdd, ...state.archivedIds].slice(0, MAX_ARCHIVED) };
        }
        case 'UNARCHIVE_MANY': {
            const removing = new Set(action.taskIds);
            const next = state.archivedIds.filter(id => !removing.has(id));
            if (next.length === state.archivedIds.length) return state;
            return { ...state, archivedIds: next };
        }
        default:
            return state;
    }
}

// ── Provider ───────────────────────────────────────────────────────────────

/**
 * Provider for chat pin/archive state.
 *
 * Pin/archive state is now derived from process summaries (which include
 * `pinnedAt` and `archived` fields from SQLite). The parent component
 * must call `dispatch({ type: 'SET_ALL', ... })` after loading process
 * summaries to populate the initial state.
 */
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

    return (
        <ChatPreferencesContext.Provider value={{ state, dispatch, workspaceId }}>
            {children}
        </ChatPreferencesContext.Provider>
    );
}

// ── History sync helper ────────────────────────────────────────────────────

interface HistoryLikeItem {
    id: string;
    pinnedAt?: string;
    archived?: boolean;
}

/**
 * Syncs pin/archive state from history items (e.g. ProcessHistoryItem) into
 * the ChatPreferencesContext. Must be rendered inside a ChatPreferencesProvider.
 */
export function ChatPrefsSync<T extends HistoryLikeItem>({
    history,
    workspaceId,
}: {
    history: T[];
    workspaceId: string;
}) {
    const { dispatch } = useChatPrefs();
    const prevHistoryRef = useRef<T[]>([]);

    useEffect(() => {
        if (history === prevHistoryRef.current) return;
        prevHistoryRef.current = history;

        const pinnedIds = history
            .filter(h => h.pinnedAt)
            .sort((a, b) => (b.pinnedAt! > a.pinnedAt! ? 1 : -1))
            .map(h => h.id);
        const archivedIds = history
            .filter(h => h.archived)
            .map(h => h.id);
        dispatch({ type: 'SET_ALL', pinnedIds, archivedIds, workspaceId });
    }, [history, workspaceId, dispatch]);

    return null;
}
