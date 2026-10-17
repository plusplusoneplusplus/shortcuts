import { useState, useEffect, useCallback } from 'react';
import type { TokenUsageStatsResponse } from '@plusplusoneplusplus/coc-client';
import { useAdminServer } from '../../../admin/adminTarget';

export function useTokenUsageStats(days?: number): {
    data: TokenUsageStatsResponse | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
} {
    const adminServer = useAdminServer();
    const [data, setData] = useState<TokenUsageStatsResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await adminServer.client.stats.tokenUsage(days ? { days } : undefined);
            setData(result);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [adminServer, days]);

    useEffect(() => { load(); }, [load]);

    return { data, loading, error, reload: load };
}
