/**
 * Context object and consumer hooks for ChatPreferencesContext. Kept in their
 * own module so surfaces that only *optionally* participate (the chat header's
 * Pin action) keep working where tests replace ChatPreferencesContext wholesale.
 */

import { createContext, useCallback, useContext, type Dispatch } from 'react';
import {
    pinProcess as apiPinProcess,
    unpinProcess as apiUnpinProcess,
    archiveProcess as apiArchiveProcess,
    unarchiveProcess as apiUnarchiveProcess,
    archiveProcesses as apiArchiveProcesses,
    unarchiveProcesses as apiUnarchiveProcesses,
} from '../queue/hooks/pinArchiveApi';
import type { ChatPrefsAction, ChatPrefsState } from './ChatPreferencesContext';

// ── Context ────────────────────────────────────────────────────────────────

export const ChatPreferencesContext = createContext<{
    state: ChatPrefsState;
    dispatch: Dispatch<ChatPrefsAction>;
    workspaceId: string;
} | null>(null);

const EMPTY_STATE: ChatPrefsState = { pinnedIds: [], archivedIds: [], loaded: false, workspaceId: '' };
const NOOP_DISPATCH: Dispatch<ChatPrefsAction> = () => {};

// ── Consumer hook ──────────────────────────────────────────────────────────

export interface ChatPrefsAPI {
    pinnedChatIds: Set<string>;
    archivedChatIds: Set<string>;
    pinChat: (taskId: string) => void;
    unpinChat: (taskId: string) => void;
    /**
     * Pin or unpin regardless of the locally known state, rolling the optimistic
     * update back and rejecting when the owning server refuses. Used by surfaces
     * that read persisted pin state from the process itself (the chat header).
     */
    setChatPinned: (taskId: string, pinned: boolean) => Promise<void>;
    archiveChat: (taskId: string) => void;
    unarchiveChat: (taskId: string) => void;
    archiveChats: (taskIds: string[]) => void;
    unarchiveChats: (taskIds: string[]) => void;
    loaded: boolean;
    dispatch: Dispatch<ChatPrefsAction>;
}

export function useChatPrefs(): ChatPrefsAPI {
    const api = useOptionalChatPrefs();
    if (!api) throw new Error('useChatPrefs must be used within ChatPreferencesProvider');
    return api;
}

/** Like `useChatPrefs`, but returns null outside a `ChatPreferencesProvider`. */
export function useOptionalChatPrefs(): ChatPrefsAPI | null {
    const ctx = useContext(ChatPreferencesContext);
    const state = ctx?.state ?? EMPTY_STATE;
    const dispatch = ctx?.dispatch ?? NOOP_DISPATCH;
    const workspaceId = ctx?.workspaceId ?? '';

    const setChatPinned = useCallback(async (taskId: string, pinned: boolean) => {
        const wasPinned = state.pinnedIds.includes(taskId);
        const wasArchived = state.archivedIds.includes(taskId);
        dispatch({ type: pinned ? 'PIN' : 'UNPIN', taskId });
        try {
            await (pinned ? apiPinProcess : apiUnpinProcess)(taskId, workspaceId);
        } catch (err) {
            if (wasPinned !== pinned) dispatch({ type: wasPinned ? 'PIN' : 'UNPIN', taskId });
            if (pinned && wasArchived) dispatch({ type: 'ARCHIVE', taskId });
            throw err;
        }
    }, [dispatch, state.pinnedIds, state.archivedIds, workspaceId]);

    const pinChat = useCallback((taskId: string) => {
        if (state.pinnedIds.includes(taskId)) return;
        setChatPinned(taskId, true).catch(() => {});
    }, [setChatPinned, state.pinnedIds]);

    const unpinChat = useCallback((taskId: string) => {
        if (!state.pinnedIds.includes(taskId)) return;
        setChatPinned(taskId, false).catch(() => {});
    }, [setChatPinned, state.pinnedIds]);

    const archiveChat = useCallback((taskId: string) => {
        if (state.archivedIds.includes(taskId)) return;
        dispatch({ type: 'ARCHIVE', taskId });
        apiArchiveProcess(taskId, workspaceId).catch(() => {});
    }, [dispatch, state.archivedIds, workspaceId]);

    const unarchiveChat = useCallback((taskId: string) => {
        if (!state.archivedIds.includes(taskId)) return;
        dispatch({ type: 'UNARCHIVE', taskId });
        apiUnarchiveProcess(taskId, workspaceId).catch(() => {});
    }, [dispatch, state.archivedIds, workspaceId]);

    const archiveChats = useCallback((taskIds: string[]) => {
        const toAdd = taskIds.filter(id => !state.archivedIds.includes(id));
        if (toAdd.length === 0) return;
        dispatch({ type: 'ARCHIVE_MANY', taskIds });
        apiArchiveProcesses(taskIds, workspaceId).catch(() => {});
    }, [dispatch, state.archivedIds, workspaceId]);

    const unarchiveChats = useCallback((taskIds: string[]) => {
        const removing = new Set(taskIds);
        const filtered = state.archivedIds.filter(id => !removing.has(id));
        if (filtered.length === state.archivedIds.length) return;
        dispatch({ type: 'UNARCHIVE_MANY', taskIds });
        apiUnarchiveProcesses(taskIds, workspaceId).catch(() => {});
    }, [dispatch, state.archivedIds, workspaceId]);

    if (!ctx) return null;
    return {
        pinnedChatIds: new Set(state.pinnedIds),
        archivedChatIds: new Set(state.archivedIds),
        pinChat,
        unpinChat,
        setChatPinned,
        archiveChat,
        unarchiveChat,
        archiveChats,
        unarchiveChats,
        loaded: state.loaded,
        dispatch,
    };
}
