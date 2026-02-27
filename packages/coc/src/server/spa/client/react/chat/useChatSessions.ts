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
}

function toSessionItem(task: any): ChatSessionItem {
    return {
        id: task.id,
        processId: task.processId,
        status: task.status ?? 'unknown',
        createdAt: task.createdAt ?? '',
        completedAt: task.completedAt,
        firstMessage: task.firstMessage ?? task.payload?.prompt ?? '',
        turnCount: task.turnCount,
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

    return { sessions, loading, error, refresh: fetchSessions };
}
