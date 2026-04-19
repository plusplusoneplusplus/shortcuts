/**
 * useNotesAutoCommit — custom hook encapsulating auto-commit schedule
 * state and actions for the notes git feature.
 *
 * Single source of truth: calls the dedicated GET auto-commit/status
 * endpoint rather than parsing the local schedules array.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { notesApi } from '../repos/notesApi';
import { describeCron } from '../utils/cron';

export interface UseNotesAutoCommitReturn {
    autoCommitEnabled: boolean;
    scheduleId: string | null;
    cron: string | null;
    cronDescription: string | null;
    nextRun: string | null;
    status: 'active' | 'paused' | null;
    lastRunStatus: 'completed' | 'failed' | null;
    loading: boolean;
    enabling: boolean;
    enable: (cron?: string) => Promise<void>;
    disable: () => Promise<void>;
    updateInterval: (cron: string) => Promise<void>;
}

export function useNotesAutoCommit(workspaceId: string): UseNotesAutoCommitReturn {
    const [autoCommitEnabled, setAutoCommitEnabled] = useState(false);
    const [scheduleId, setScheduleId] = useState<string | null>(null);
    const [cron, setCron] = useState<string | null>(null);
    const [nextRun, setNextRun] = useState<string | null>(null);
    const [status, setStatus] = useState<'active' | 'paused' | null>(null);
    const [lastRunStatus, setLastRunStatus] = useState<'completed' | 'failed' | null>(null);
    const [loading, setLoading] = useState(true);
    const [enabling, setEnabling] = useState(false);

    const cancelledRef = useRef(false);

    const fetchStatus = useCallback(async () => {
        try {
            const data = await notesApi.getAutoCommitStatus(workspaceId);
            if (cancelledRef.current) return;

            if (data.enabled && data.schedule) {
                setAutoCommitEnabled(true);
                setScheduleId(data.schedule.id);
                setCron(data.schedule.cron);
                setNextRun(data.schedule.nextRun ?? null);
                setStatus((data.schedule.status as 'active' | 'paused') ?? null);
                setLastRunStatus(
                    data.lastRun?.status === 'completed' || data.lastRun?.status === 'failed'
                        ? data.lastRun.status
                        : null,
                );
            } else {
                setAutoCommitEnabled(false);
                setScheduleId(null);
                setCron(null);
                setNextRun(null);
                setStatus(null);
                setLastRunStatus(null);
            }
        } catch {
            if (cancelledRef.current) return;
            setAutoCommitEnabled(false);
            setScheduleId(null);
            setCron(null);
            setNextRun(null);
            setStatus(null);
            setLastRunStatus(null);
        }
    }, [workspaceId]);

    // Initial load
    useEffect(() => {
        cancelledRef.current = false;
        setLoading(true);
        fetchStatus().finally(() => {
            if (!cancelledRef.current) setLoading(false);
        });
        return () => { cancelledRef.current = true; };
    }, [workspaceId, fetchStatus]);

    // Listen for schedule-changed events (from WebSocket)
    useEffect(() => {
        const handler = () => { fetchStatus(); };
        window.addEventListener('schedule-changed', handler);
        return () => window.removeEventListener('schedule-changed', handler);
    }, [fetchStatus]);

    const enable = useCallback(async (cronExpr?: string) => {
        setEnabling(true);
        try {
            await notesApi.enableAutoCommit(workspaceId, cronExpr);
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

    const updateInterval = useCallback(async (cronExpr: string) => {
        try {
            await notesApi.updateAutoCommitInterval(workspaceId, cronExpr);
            await fetchStatus();
        } catch {
            // Error handled silently
        }
    }, [workspaceId, fetchStatus]);

    return {
        autoCommitEnabled,
        scheduleId,
        cron,
        cronDescription: cron ? describeCron(cron) : null,
        nextRun,
        status,
        lastRunStatus,
        loading,
        enabling,
        enable,
        disable,
        updateInterval,
    };
}
