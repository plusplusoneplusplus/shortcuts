/**
 * useAllLoops — hook to fetch all loops server-wide and group by processId.
 *
 * Used by ChatListPane to show inline loop indicators and the "Loops" scope
 * filter. Only fetches when `isLoopsEnabled()` is true. Listens for WebSocket
 * loop events to keep state fresh.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';
import { isLoopsEnabled } from '../../../utils/config';
import type { LoopEntry } from '@plusplusoneplusplus/coc-client';

export type ProcessLoopState = 'active' | 'paused' | null;

export interface UseAllLoopsResult {
    /** Map from processId → loop state ('active' if any active, 'paused' if only paused). */
    loopStateByProcess: Map<string, ProcessLoopState>;
    /** Set of processIds that have at least one active or paused loop. */
    processIdsWithLoops: Set<string>;
    /** Number of distinct processes with active or paused loops. */
    loopProcessCount: number;
    /** Whether the initial fetch is still in progress. */
    loading: boolean;
}

const EMPTY_MAP = new Map<string, ProcessLoopState>();
const EMPTY_SET = new Set<string>();
const EMPTY_RESULT: UseAllLoopsResult = {
    loopStateByProcess: EMPTY_MAP,
    processIdsWithLoops: EMPTY_SET,
    loopProcessCount: 0,
    loading: false,
};

function groupByProcess(loops: LoopEntry[]): Map<string, ProcessLoopState> {
    const map = new Map<string, ProcessLoopState>();
    for (const loop of loops) {
        if (loop.status !== 'active' && loop.status !== 'paused') continue;
        const current = map.get(loop.processId);
        // 'active' takes priority over 'paused'
        if (current === 'active') continue;
        map.set(loop.processId, loop.status === 'active' ? 'active' : 'paused');
    }
    return map;
}

export function useAllLoops(): UseAllLoopsResult {
    const [loops, setLoops] = useState<LoopEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const mountedRef = useRef(true);

    const enabled = isLoopsEnabled();

    const fetchLoops = useCallback(() => {
        if (!enabled) {
            setLoops([]);
            return;
        }
        setLoading(true);
        getSpaCocClient().loops.listAll()
            .then((all) => {
                if (!mountedRef.current) return;
                setLoops(all);
            })
            .catch(() => { /* best-effort */ })
            .finally(() => {
                if (mountedRef.current) setLoading(false);
            });
    }, [enabled]);

    useEffect(() => {
        mountedRef.current = true;
        fetchLoops();
        return () => { mountedRef.current = false; };
    }, [fetchLoops]);

    // Listen for WebSocket loop events to refresh
    useEffect(() => {
        if (!enabled) return;

        const handler = ((e: CustomEvent) => {
            const msg = e.detail;
            if (!msg?.type?.startsWith('loop-')) return;
            fetchLoops();
        }) as EventListener;

        window.addEventListener('coc-ws-message' as any, handler);
        return () => {
            window.removeEventListener('coc-ws-message' as any, handler);
        };
    }, [enabled, fetchLoops]);

    const loopStateByProcess = useMemo(() => groupByProcess(loops), [loops]);
    const processIdsWithLoops = useMemo(
        () => new Set(loopStateByProcess.keys()),
        [loopStateByProcess],
    );

    if (!enabled) return EMPTY_RESULT;

    return {
        loopStateByProcess,
        processIdsWithLoops,
        loopProcessCount: processIdsWithLoops.size,
        loading,
    };
}
