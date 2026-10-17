import { useState, useEffect, useCallback } from 'react';
import type {
    TurnPerformanceGroupBy,
    TurnPerformanceStatsQuery,
    TurnPerformanceStatsResponse,
} from '@plusplusoneplusplus/coc-client';
import { useAdminServer } from '../../../admin/adminTarget';

// Params are primitives (not an options object) so callers can pass inline
// values without retriggering the effect on every render.
export function useTurnPerformanceStats(
    days: number | undefined,
    groupBy: TurnPerformanceGroupBy,
    firstTurnOnly: boolean
): {
    data: TurnPerformanceStatsResponse | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
} {
    const adminServer = useAdminServer();
    const [data, setData] = useState<TurnPerformanceStatsResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const query: TurnPerformanceStatsQuery = { groupBy };
            if (days) query.days = days;
            if (firstTurnOnly) query.firstTurnOnly = true;
            const result = await adminServer.client.stats.turnPerformance(query);
            setData(result);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [adminServer, days, groupBy, firstTurnOnly]);

    useEffect(() => { load(); }, [load]);

    return { data, loading, error, reload: load };
}
