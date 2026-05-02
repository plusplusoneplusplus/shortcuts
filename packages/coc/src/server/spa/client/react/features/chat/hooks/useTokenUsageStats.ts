import { useState, useEffect, useCallback } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';
import type { TokenUsageStatsResponse } from '@plusplusoneplusplus/coc-client';

export function useTokenUsageStats(days?: number): {
    data: TokenUsageStatsResponse | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
} {
    const [data, setData] = useState<TokenUsageStatsResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await getSpaCocClient().stats.tokenUsage(days ? { days } : undefined);
            setData(result);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [days]);

    useEffect(() => { load(); }, [load]);

    return { data, loading, error, reload: load };
}
