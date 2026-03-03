/**
 * useChatSessions — custom hook for fetching and managing chat session history.
 *
 * Fetches from GET /api/queue/history?type=chat&repoId=... on mount and
 * when workspaceId changes. Exposes sessions, loading, error, and refresh().
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchApi } from '../hooks/useApi';
import type { ChatSessionItem } from '../types/dashboard';

export interface UseChatSessionsResult {
    sessions: ChatSessionItem[];
    loading: boolean;
    error: string | null;
    refresh: () => void;
    /** Optimistically prepend a session to the top of the list. */
    prependSession: (session: ChatSessionItem) => void;
    /** Optimistically update a single session's status in local state. */
    updateSessionStatus: (taskId: string, status: string) => void;
    /** Optimistically update a single session's title in local state. */
    updateSessionTitle: (taskId: string, title: string) => void;
}

function toSessionItem(task: any): ChatSessionItem {
    return {
        id: task.id,
        processId: task.processId,
        status: task.status ?? 'unknown',
        createdAt: typeof task.createdAt === 'number'
            ? new Date(task.createdAt).toISOString()
            : (task.createdAt ?? ''),
        completedAt: typeof task.completedAt === 'number'
            ? new Date(task.completedAt).toISOString()
            : task.completedAt,
        lastActivityAt: typeof task.chatMeta?.lastActivityAt === 'number'
            ? new Date(task.chatMeta.lastActivityAt).toISOString()
            : task.chatMeta?.lastActivityAt,
        firstMessage: task.chatMeta?.firstMessage || task.firstMessage || task.payload?.prompt || '',
        title: task.chatMeta?.title,
        turnCount: task.chatMeta?.turnCount ?? task.turnCount,
    };
}

export function useChatSessions(workspaceId: string): UseChatSessionsResult {
    const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const mountedRef = useRef(true);

    const fetchSessions = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchApi(
                `/queue/history?type=chat&repoId=${encodeURIComponent(workspaceId)}`
            );
            if (!mountedRef.current) return;
            const items = (data?.history ?? []).map(toSessionItem);
            setSessions(items);
        } catch (err: any) {
            if (!mountedRef.current) return;
            setError(err?.message ?? 'Failed to load chat sessions');
            setSessions([]);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [workspaceId]);

    useEffect(() => {
        mountedRef.current = true;
        fetchSessions();
        return () => { mountedRef.current = false; };
    }, [fetchSessions]);

    const prependSession = useCallback((session: ChatSessionItem) => {
        setSessions(prev => {
            if (prev.some(s => s.id === session.id)) return prev;
            return [session, ...prev];
        });
    }, []);

    const updateSessionStatus = useCallback((taskId: string, status: string) => {
        setSessions(prev => prev.map(s => s.id === taskId ? { ...s, status } : s));
    }, []);

    const updateSessionTitle = useCallback((taskId: string, title: string) => {
        setSessions(prev => prev.map(s => s.id === taskId ? { ...s, title } : s));
    }, []);

    return { sessions, loading, error, refresh: fetchSessions, prependSession, updateSessionStatus, updateSessionTitle };
}
