/**
 * useNotesAutoCommit — custom hook encapsulating auto-commit timer
 * state and actions for the notes git feature.
 *
 * Single source of truth: calls the dedicated GET auto-commit/status
 * endpoint rather than parsing local state.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { notesApi } from '../notesApi';

export interface UseNotesAutoCommitReturn {
    autoCommitEnabled: boolean;
    intervalMs: number | null;
    lastCommittedAt: string | null;
    lastError: string | null;
    loading: boolean;
    enabling: boolean;
    enable: (intervalMs?: number) => Promise<void>;
    disable: () => Promise<void>;
    updateInterval: (intervalMs: number) => Promise<void>;
}

export function useNotesAutoCommit(workspaceId: string, isDefaultRoot = true): UseNotesAutoCommitReturn {
    const [autoCommitEnabled, setAutoCommitEnabled] = useState(false);
    const [intervalMs, setIntervalMs] = useState<number | null>(null);
    const [lastCommittedAt, setLastCommittedAt] = useState<string | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [enabling, setEnabling] = useState(false);

    const cancelledRef = useRef(false);

    const fetchStatus = useCallback(async () => {
        try {
            const data = await notesApi.getAutoCommitStatus(workspaceId);
            if (cancelledRef.current) return;

            if (data.enabled) {
                setAutoCommitEnabled(true);
                setIntervalMs(data.intervalMs ?? null);
                setLastCommittedAt(data.lastCommittedAt ?? null);
                setLastError(data.lastError ?? null);
            } else {
                setAutoCommitEnabled(false);
                setIntervalMs(null);
                setLastCommittedAt(null);
                setLastError(null);
            }
        } catch {
            if (cancelledRef.current) return;
            setAutoCommitEnabled(false);
            setIntervalMs(null);
            setLastCommittedAt(null);
            setLastError(null);
        }
    }, [workspaceId]);

    // Initial load
    useEffect(() => {
        cancelledRef.current = false;

        // Auto-commit is only available for the default managed root
        if (!isDefaultRoot) {
            setAutoCommitEnabled(false);
            setIntervalMs(null);
            setLastCommittedAt(null);
            setLastError(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        fetchStatus().finally(() => {
            if (!cancelledRef.current) setLoading(false);
        });
        return () => { cancelledRef.current = true; };
    }, [workspaceId, isDefaultRoot, fetchStatus]);

    const enable = useCallback(async (ms?: number) => {
        setEnabling(true);
        try {
            await notesApi.enableAutoCommit(workspaceId, ms);
            await fetchStatus();
        } catch {
            // Error handled silently — state remains unchanged
        } finally {
            if (!cancelledRef.current) setEnabling(false);
        }
    }, [workspaceId, fetchStatus]);

    const disable = useCallback(async () => {
        try {
            await notesApi.disableAutoCommit(workspaceId);
            await fetchStatus();
        } catch {
            // Error handled silently
        }
    }, [workspaceId, fetchStatus]);

    const updateInterval = useCallback(async (ms: number) => {
        try {
            await notesApi.updateAutoCommitInterval(workspaceId, ms);
            await fetchStatus();
        } catch {
            // Error handled silently
        }
    }, [workspaceId, fetchStatus]);

    return {
        autoCommitEnabled,
        intervalMs,
        lastCommittedAt,
        lastError,
        loading,
        enabling,
        enable,
        disable,
        updateInterval,
    };
}
