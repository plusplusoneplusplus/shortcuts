/**
 * FloatingChatsContext — tracks tasks currently floated as overlay dialogs.
 *
 * Components call `floatChat` to detach a chat into a floating dialog,
 * `unfloatChat` to restore it inline, and `isFloating` to check the state.
 */

import { createContext, useContext, useCallback, useMemo, useState, type ReactNode } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FloatingChatEntry {
    taskId: string;
    workspaceId?: string;
    /** Short display label used in the FloatingDialog title and minimized tray pill. */
    title: string;
    /** Task status at float-time (used for tray pill icon). */
    status: string;
}

export interface FloatingChatsContextValue {
    floatingChats: Map<string, FloatingChatEntry>;
    floatChat(entry: FloatingChatEntry): void;
    unfloatChat(taskId: string): void;
    isFloating(taskId: string): boolean;
}

// ── Context ────────────────────────────────────────────────────────────────────

const FloatingChatsContext = createContext<FloatingChatsContextValue>({
    floatingChats: new Map(),
    floatChat: () => {},
    unfloatChat: () => {},
    isFloating: () => false,
});

// ── Provider ───────────────────────────────────────────────────────────────────

export function FloatingChatsProvider({ children }: { children: ReactNode }) {
    const [floatingChats, setFloatingChats] = useState<Map<string, FloatingChatEntry>>(new Map());

    const floatChat = useCallback((entry: FloatingChatEntry) => {
        setFloatingChats(prev => {
            const next = new Map(prev);
            next.set(entry.taskId, entry);
            return next;
        });
    }, []);

    const unfloatChat = useCallback((taskId: string) => {
        setFloatingChats(prev => {
            if (!prev.has(taskId)) return prev;
            const next = new Map(prev);
            next.delete(taskId);
            return next;
        });
    }, []);

    const isFloating = useCallback((taskId: string) => {
        return floatingChats.has(taskId);
    }, [floatingChats]);

    const value = useMemo<FloatingChatsContextValue>(() => ({
        floatingChats,
        floatChat,
        unfloatChat,
        isFloating,
    }), [floatingChats, floatChat, unfloatChat, isFloating]);

    return (
        <FloatingChatsContext.Provider value={value}>
            {children}
        </FloatingChatsContext.Provider>
    );
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useFloatingChats(): FloatingChatsContextValue {
    return useContext(FloatingChatsContext);
}
