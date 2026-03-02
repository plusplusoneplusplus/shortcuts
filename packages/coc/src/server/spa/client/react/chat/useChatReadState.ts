/**
 * useChatReadState — custom hook for tracking unread chat sessions.
 *
 * Persists per-workspace read-state to localStorage under `coc:chatReadState`.
 * Exposes `isUnread()`, `markRead()`, and `unreadCount()` functions.
 * First visit: all sessions appear as read (no false unread flood).
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type { ChatSessionItem } from '../types/dashboard';

const STORAGE_KEY = 'coc:chatReadState';

interface SessionReadEntry {
    lastSeenTurnCount: number;
}

type WorkspaceReadState = Record<string, SessionReadEntry>;
type AllReadState = Record<string, WorkspaceReadState>;

export interface UseChatReadStateResult {
    /** Whether a session has unread turns (turnCount > lastSeenTurnCount). */
    isUnread: (sessionId: string, currentTurnCount?: number) => boolean;
    /** Mark a session as read at its current turn count. */
    markRead: (sessionId: string, turnCount: number) => void;
    /** Count of unread sessions from a list. */
    unreadCount: (sessions: ChatSessionItem[]) => number;
}

function loadAllState(): AllReadState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function saveAllState(state: AllReadState): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Best-effort: storage full or private browsing
    }
}

export function useChatReadState(workspaceId: string): UseChatReadStateResult {
    const [wsState, setWsState] = useState<WorkspaceReadState>({});
    const allStateRef = useRef<AllReadState>({});
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        const all = loadAllState();
        allStateRef.current = all;
        if (mountedRef.current) {
            setWsState(all[workspaceId] ?? {});
        }
        return () => { mountedRef.current = false; };
    }, [workspaceId]);

    const isUnread = useCallback(
        (sessionId: string, currentTurnCount?: number): boolean => {
            if (currentTurnCount == null || currentTurnCount <= 0) return false;
            const entry = wsState[sessionId];
            if (!entry) return false; // First visit: no entry = read
            return currentTurnCount > entry.lastSeenTurnCount;
        },
        [wsState],
    );

    const markRead = useCallback(
        (sessionId: string, turnCount: number): void => {
            setWsState(prev => {
                const next = { ...prev, [sessionId]: { lastSeenTurnCount: turnCount } };

                const updated = { ...allStateRef.current, [workspaceId]: next };
                allStateRef.current = updated;
                saveAllState(updated);

                return next;
            });
        },
        [workspaceId],
    );

    const unreadCount = useCallback(
        (sessions: ChatSessionItem[]): number => {
            return sessions.filter(s => isUnread(s.id, s.turnCount)).length;
        },
        [isUnread],
    );

    return { isUnread, markRead, unreadCount };
}
