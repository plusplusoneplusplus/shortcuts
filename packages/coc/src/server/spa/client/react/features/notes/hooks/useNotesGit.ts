/**
 * useNotesGit — encapsulates all notes-git API interactions and
 * window-event-driven auto-refresh.
 *
 * Fetches status + log on mount.  Listens for `notes-changed` CustomEvents
 * (dispatched by App.tsx when the server emits a WebSocket message) to keep
 * data fresh after auto-commits or manual saves.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from '../../../hooks/useApi';
import type { NotesGitStatus, NotesGitLogEntry, NotesGitDiff } from '../../../../notes-git-types';

export interface UseNotesGitReturn {
    status: NotesGitStatus | null;
    log: NotesGitLogEntry[];
    loading: boolean;
    error: string | null;
    initialized: boolean;
    initialize: () => Promise<void>;
    commit: (message?: string) => Promise<void>;
    getDiff: (hash?: string) => Promise<NotesGitDiff>;
    refresh: () => Promise<void>;
}

const basePath = (wsId: string) =>
    `/workspaces/${encodeURIComponent(wsId)}/notes/git`;

export function useNotesGit(workspaceId: string): UseNotesGitReturn {
    const [status, setStatus] = useState<NotesGitStatus | null>(null);
    const [log, setLog] = useState<NotesGitLogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [initialized, setInitialized] = useState(false);

    const cancelledRef = useRef(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Core fetch helpers ──────────────────────────────────────────

    const fetchStatus = useCallback(async (): Promise<NotesGitStatus | null> => {
        try {
            const data: NotesGitStatus = await fetchApi(`${basePath(workspaceId)}/status`);
            return data;
        } catch {
            return null;
        }
    }, [workspaceId]);

    const fetchLog = useCallback(async (): Promise<NotesGitLogEntry[]> => {
        try {
            const data = await fetchApi(`${basePath(workspaceId)}/log`);
            return data?.entries ?? [];
        } catch {
            return [];
        }
    }, [workspaceId]);

    // ── Refresh: re-fetch status + log ──────────────────────────────

    const refresh = useCallback(async () => {
        const [s, l] = await Promise.all([fetchStatus(), fetchLog()]);
        if (cancelledRef.current) return;
        if (s) {
            setStatus(s);
            setInitialized(s.initialized);
            setLog(l);
            setError(null);
        } else {
            setError('Failed to fetch notes git status');
        }
    }, [fetchStatus, fetchLog]);

    // ── Mount: initial load ─────────────────────────────────────────

    useEffect(() => {
        cancelledRef.current = false;
        setLoading(true);
        setError(null);

        (async () => {
            const s = await fetchStatus();
            if (cancelledRef.current) return;

            if (!s) {
                setError('Failed to fetch notes git status');
                setLoading(false);
                return;
            }

            setStatus(s);
            setInitialized(s.initialized);

            if (s.initialized) {
                const l = await fetchLog();
                if (cancelledRef.current) return;
                setLog(l);
            }

            setLoading(false);
        })();

        return () => {
            cancelledRef.current = true;
        };
    }, [workspaceId, fetchStatus, fetchLog]);

    // ── Window event listener: notes-changed → debounced refresh ────

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as
                | { wsId: string; changedPaths?: string[] }
                | undefined;
            if (detail?.wsId !== workspaceId) return;

            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                refresh();
            }, 500);
        };
        window.addEventListener('notes-changed', handler);
        return () => {
            window.removeEventListener('notes-changed', handler);
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [workspaceId, refresh]);

    // ── Actions ─────────────────────────────────────────────────────

    const initialize = useCallback(async () => {
        setLoading(true);
        try {
            await fetchApi(`${basePath(workspaceId)}/init`, { method: 'POST' });
            await refresh();
        } catch (err: any) {
            setError(err?.message ?? 'Failed to initialize notes git');
        } finally {
            setLoading(false);
        }
    }, [workspaceId, refresh]);

    const commit = useCallback(async (message?: string) => {
        try {
            const body = message ? JSON.stringify({ message }) : undefined;
            const headers = message ? { 'Content-Type': 'application/json' } : undefined;
            await fetchApi(`${basePath(workspaceId)}/commit`, {
                method: 'POST',
                headers,
                body,
            });
            await refresh();
        } catch (err: any) {
            setError(err?.message ?? 'Failed to commit');
        }
    }, [workspaceId, refresh]);

    const getDiff = useCallback(async (hash?: string): Promise<NotesGitDiff> => {
        const qs = hash ? `/${encodeURIComponent(hash)}` : '';
        const data: NotesGitDiff = await fetchApi(`${basePath(workspaceId)}/diff${qs}`);
        return data;
    }, [workspaceId]);

    return {
        status,
        log,
        loading,
        error,
        initialized,
        initialize,
        commit,
        getDiff,
        refresh,
    };
}
