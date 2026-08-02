/**
 * useCrons — hook to fetch and track cron state for a conversation.
 *
 * Fetches crons associated with the current process, listens for WebSocket
 * cron events to keep state up to date in real time.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useCocClient } from '../../../repos/cloneRouting';
import { isCronEnabled } from '../../../utils/config';
import type { CronEntry } from '@plusplusoneplusplus/coc-client';

export interface UseCronsResult {
    /** All crons associated with this process. */
    crons: CronEntry[];
    /** Number of active crons. */
    activeCount: number;
    /** Number of crons that can still be managed from the dashboard. */
    manageableCount: number;
    /** Whether any manageable crons are actively running. */
    hasActiveCrons: boolean;
    /** Whether the initial fetch is still in progress. */
    loading: boolean;
    /** Pause an active cron. */
    pause: (cronId: string, reason?: string) => Promise<void>;
    /** Resume a paused cron. */
    resume: (cronId: string) => Promise<void>;
    /** Cancel a cron. */
    cancel: (cronId: string) => Promise<void>;
    /** Re-fetch crons from the server. */
    refresh: () => void;
}

export function useCrons(workspaceId: string | undefined, processId: string | null): UseCronsResult {
    // AC-02: crons are workspace-scoped, so we fetch the full workspace list and
    // keep it keyed by workspace only. The per-process view is derived client-side
    // (below) so switching conversations within the same workspace never re-issues
    // `crons.list` — the fetch dependency intentionally omits processId.
    const [allCrons, setAllCrons] = useState<CronEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const mountedRef = useRef(true);
    // AC-07: cron list/pause/resume/cancel target the selected clone's server.
    const cloneClient = useCocClient(workspaceId);

    const fetchCrons = useCallback(() => {
        if (!workspaceId) return;
        // Skip network calls when crons feature is disabled — REST routes are not registered.
        if (!isCronEnabled()) {
            setAllCrons([]);
            return;
        }
        setLoading(true);
        cloneClient.crons.list(workspaceId)
            .then((all) => {
                if (!mountedRef.current) return;
                setAllCrons(all);
            })
            .catch(() => { /* ignore — crons panel is best-effort */ })
            .finally(() => {
                if (mountedRef.current) setLoading(false);
            });
    }, [workspaceId, cloneClient]);

    // Per-process view, derived from the workspace-scoped list. Re-deriving on a
    // processId change is cheap and never triggers a network round-trip.
    const crons = useMemo(
        () => (processId ? allCrons.filter(l => l.processId === processId) : allCrons),
        [allCrons, processId],
    );

    useEffect(() => {
        mountedRef.current = true;
        fetchCrons();
        return () => { mountedRef.current = false; };
    }, [fetchCrons]);

    // Listen for WebSocket cron events
    useEffect(() => {
        if (!processId) return;
        if (!isCronEnabled()) return;

        const handler = ((e: CustomEvent) => {
            const msg = e.detail;
            if (!msg?.type?.startsWith('cron-')) return;
            if (msg.processId !== processId) return;
            fetchCrons();
        }) as EventListener;

        window.addEventListener('coc-ws-message' as any, handler);
        return () => {
            window.removeEventListener('coc-ws-message' as any, handler);
        };
    }, [processId, fetchCrons]);

    const pause = useCallback(async (cronId: string, reason?: string) => {
        if (!workspaceId) return;
        await cloneClient.crons.pause(workspaceId, cronId, reason);
        fetchCrons();
    }, [workspaceId, fetchCrons, cloneClient]);

    const resume = useCallback(async (cronId: string) => {
        if (!workspaceId) return;
        await cloneClient.crons.resume(workspaceId, cronId);
        fetchCrons();
    }, [workspaceId, fetchCrons, cloneClient]);

    const cancel = useCallback(async (cronId: string) => {
        if (!workspaceId) return;
        await cloneClient.crons.delete(workspaceId, cronId);
        fetchCrons();
    }, [workspaceId, fetchCrons, cloneClient]);

    const activeCount = crons.filter(l => l.status === 'active').length;
    const manageableCount = crons.filter(l => l.status !== 'cancelled').length;
    const hasActiveCrons = activeCount > 0;

    return { crons, activeCount, manageableCount, hasActiveCrons, loading, pause, resume, cancel, refresh: fetchCrons };
}
