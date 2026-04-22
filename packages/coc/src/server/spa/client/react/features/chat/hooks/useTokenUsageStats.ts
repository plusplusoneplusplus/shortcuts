import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../../../hooks/useApi';
import { ClientTokenUsageStatsResponse } from '../../../types/dashboard';

export function useTokenUsageStats(days?: number): {
    data: ClientTokenUsageStatsResponse | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
} {
    const [data, setData] = useState<ClientTokenUsageStatsResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const path = '/stats/token-usage' + (days ? '?days=' + days : '');
            const result = await fetchApi(path);
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
