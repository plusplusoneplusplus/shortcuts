/**
 * useLoops — hook to fetch and track loop state for a conversation.
 *
 * Fetches loops associated with the current process, listens for WebSocket
 * loop events to keep state up to date in real time.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';
import { isLoopsEnabled } from '../../../utils/config';
import type { LoopEntry } from '@plusplusoneplusplus/coc-client';

export interface UseLoopsResult {
    /** All loops associated with this process. */
    loops: LoopEntry[];
    /** Number of active loops. */
    activeCount: number;
    /** Number of loops that can still be managed from the dashboard. */
    manageableCount: number;
    /** Whether any manageable loops are actively running. */
    hasActiveLoops: boolean;
    /** Whether the initial fetch is still in progress. */
    loading: boolean;
    /** Pause an active loop. */
    pause: (loopId: string, reason?: string) => Promise<void>;
    /** Resume a paused loop. */
    resume: (loopId: string) => Promise<void>;
    /** Cancel a loop. */
    cancel: (loopId: string) => Promise<void>;
    /** Re-fetch loops from the server. */
    refresh: () => void;
}

export function useLoops(workspaceId: string | undefined, processId: string | null): UseLoopsResult {
    const [loops, setLoops] = useState<LoopEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const mountedRef = useRef(true);

    const fetchLoops = useCallback(() => {
        if (!workspaceId) return;
        // Skip network calls when loops feature is disabled — REST routes are not registered.
        if (!isLoopsEnabled()) {
            setLoops([]);
            return;
        }
        setLoading(true);
        getSpaCocClient().loops.list(workspaceId)
            .then((all) => {
                if (!mountedRef.current) return;
                // Filter to loops for this process
                const filtered = processId
                    ? all.filter(l => l.processId === processId)
                    : all;
                setLoops(filtered);
            })
            .catch(() => { /* ignore — loops panel is best-effort */ })
            .finally(() => {
                if (mountedRef.current) setLoading(false);
            });
    }, [workspaceId, processId]);

    useEffect(() => {
        mountedRef.current = true;
        fetchLoops();
        return () => { mountedRef.current = false; };
    }, [fetchLoops]);

    // Listen for WebSocket loop events
    useEffect(() => {
        if (!processId) return;
        if (!isLoopsEnabled()) return;

        const handler = ((e: CustomEvent) => {
            const msg = e.detail;
            if (!msg?.type?.startsWith('loop-')) return;
            if (msg.processId !== processId) return;
            fetchLoops();
        }) as EventListener;

        window.addEventListener('coc-ws-message' as any, handler);
        return () => {
            window.removeEventListener('coc-ws-message' as any, handler);
        };
    }, [processId, fetchLoops]);

    const pause = useCallback(async (loopId: string, reason?: string) => {
        if (!workspaceId) return;
        await getSpaCocClient().loops.pause(workspaceId, loopId, reason);
        fetchLoops();
    }, [workspaceId, fetchLoops]);

    const resume = useCallback(async (loopId: string) => {
        if (!workspaceId) return;
        await getSpaCocClient().loops.resume(workspaceId, loopId);
        fetchLoops();
    }, [workspaceId, fetchLoops]);

    const cancel = useCallback(async (loopId: string) => {
        if (!workspaceId) return;
        await getSpaCocClient().loops.delete(workspaceId, loopId);
        fetchLoops();
    }, [workspaceId, fetchLoops]);

    const activeCount = loops.filter(l => l.status === 'active').length;
    const manageableCount = loops.filter(l => l.status !== 'cancelled').length;
    const hasActiveLoops = activeCount > 0;

    return { loops, activeCount, manageableCount, hasActiveLoops, loading, pause, resume, cancel, refresh: fetchLoops };
}
