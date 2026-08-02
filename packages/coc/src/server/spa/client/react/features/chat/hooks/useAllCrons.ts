/**
 * useAllCrons — hook to fetch all crons server-wide and group by processId.
 *
 * Used by ChatListPane to show inline cron indicators and the "Crons" scope
 * filter. Only fetches when `isCronEnabled()` is true. Listens for WebSocket
 * cron events to keep state fresh.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';
import { isCronEnabled } from '../../../utils/config';
import type { CronEntry } from '@plusplusoneplusplus/coc-client';

export type ProcessCronState = 'active' | 'paused' | null;

export interface UseAllCronsResult {
    /** Map from processId → cron state ('active' if any active, 'paused' if only paused). */
    cronStateByProcess: Map<string, ProcessCronState>;
    /** Set of processIds that have at least one active or paused cron. */
    processIdsWithCrons: Set<string>;
    /** Number of distinct processes with active or paused crons. */
    cronProcessCount: number;
    /** Whether the initial fetch is still in progress. */
    loading: boolean;
}

const EMPTY_MAP = new Map<string, ProcessCronState>();
const EMPTY_SET = new Set<string>();
const EMPTY_RESULT: UseAllCronsResult = {
    cronStateByProcess: EMPTY_MAP,
    processIdsWithCrons: EMPTY_SET,
    cronProcessCount: 0,
    loading: false,
};

function groupByProcess(crons: CronEntry[]): Map<string, ProcessCronState> {
    const map = new Map<string, ProcessCronState>();
    for (const cron of crons) {
        if (cron.status !== 'active' && cron.status !== 'paused') continue;
        const current = map.get(cron.processId);
        // 'active' takes priority over 'paused'
        if (current === 'active') continue;
        map.set(cron.processId, cron.status === 'active' ? 'active' : 'paused');
    }
    return map;
}

export function useAllCrons(): UseAllCronsResult {
    const [crons, setCrons] = useState<CronEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const mountedRef = useRef(true);

    const enabled = isCronEnabled();

    const fetchCrons = useCallback(() => {
        if (!enabled) {
            setCrons([]);
            return;
        }
        setLoading(true);
        getSpaCocClient().crons.listAll()
            .then((all) => {
                if (!mountedRef.current) return;
                setCrons(all);
            })
            .catch(() => { /* best-effort */ })
            .finally(() => {
                if (mountedRef.current) setLoading(false);
            });
    }, [enabled]);

    useEffect(() => {
        mountedRef.current = true;
        fetchCrons();
        return () => { mountedRef.current = false; };
    }, [fetchCrons]);

    // Listen for WebSocket cron events to refresh
    useEffect(() => {
        if (!enabled) return;

        const handler = ((e: CustomEvent) => {
            const msg = e.detail;
            if (!msg?.type?.startsWith('cron-')) return;
            fetchCrons();
        }) as EventListener;

        window.addEventListener('coc-ws-message' as any, handler);
        return () => {
            window.removeEventListener('coc-ws-message' as any, handler);
        };
    }, [enabled, fetchCrons]);

    const cronStateByProcess = useMemo(() => groupByProcess(crons), [crons]);
    const processIdsWithCrons = useMemo(
        () => new Set(cronStateByProcess.keys()),
        [cronStateByProcess],
    );

    if (!enabled) return EMPTY_RESULT;

    return {
        cronStateByProcess,
        processIdsWithCrons,
        cronProcessCount: processIdsWithCrons.size,
        loading,
    };
}
