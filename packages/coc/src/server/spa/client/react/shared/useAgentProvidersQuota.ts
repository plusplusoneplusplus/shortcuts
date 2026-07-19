import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentProvidersQuotaResponse } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';

export const AGENT_PROVIDER_QUOTA_POLL_MS = 5 * 60 * 1000;

export interface UseAgentProvidersQuotaResult {
    quotaData: AgentProvidersQuotaResponse | null;
    loading: boolean;
    refreshing: boolean;
    error: string | null;
    refresh: (options?: { force?: boolean }) => Promise<void>;
}

/**
 * Fetches and polls agent provider quota every 5 minutes.
 * Shared by AgentProviderQuotaIndicator, PauseDurationMenu, and pill controls.
 */
export function useAgentProvidersQuota(): UseAgentProvidersQuotaResult {
    const [quotaData, setQuotaData] = useState<AgentProvidersQuotaResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const mountedRef = useRef(false);
    const quotaDataRef = useRef<AgentProvidersQuotaResponse | null>(null);

    useEffect(() => {
        quotaDataRef.current = quotaData;
    }, [quotaData]);

    const refresh = useCallback(async (options: { force?: boolean } = {}) => {
        const hasExistingData = quotaDataRef.current !== null;
        if (hasExistingData) {
            setRefreshing(true);
        } else {
            setLoading(true);
        }
        setError(null);
        try {
            const data = await getSpaCocClient().admin.getAgentProvidersQuota(options.force ? { force: true } : undefined);
            if (!mountedRef.current) {
                return;
            }
            setQuotaData(data);
        } catch (err) {
            if (!mountedRef.current) {
                return;
            }
            setError(getSpaCocClientErrorMessage(err, 'Failed to load provider quota'));
        } finally {
            if (!mountedRef.current) {
                return;
            }
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        void refresh();
        const timer = window.setInterval(() => void refresh(), AGENT_PROVIDER_QUOTA_POLL_MS);
        return () => {
            mountedRef.current = false;
            window.clearInterval(timer);
        };
    }, [refresh]);

    return { quotaData, loading, refreshing, error, refresh };
}
