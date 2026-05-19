/**
 * Hook that polls the sync status endpoint at a regular interval.
 * Returns the current sync status (enabled, inProgress, lastSyncTime, lastError).
 * Stops polling when sync is not enabled.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSpaCocClient } from '../api/cocClient';
import type { SyncStatus } from '@plusplusoneplusplus/coc-client';

const POLL_INTERVAL_MS = 30_000; // 30 seconds

export interface UseSyncStatusResult {
    status: SyncStatus | null;
    /** Force a refresh of the sync status. */
    refresh: () => void;
}

export function useSyncStatus(): UseSyncStatusResult {
    const [status, setStatus] = useState<SyncStatus | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const mountedRef = useRef(true);

    const fetchStatus = useCallback(async () => {
        try {
            const data = await getSpaCocClient().sync.getStatus();
            if (mountedRef.current) setStatus(data);
        } catch {
            // Silently ignore — sync may not be available
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        fetchStatus();
        timerRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
        return () => {
            mountedRef.current = false;
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [fetchStatus]);

    return { status, refresh: fetchStatus };
}
