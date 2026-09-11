import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentProvidersQuotaResponse } from '@plusplusoneplusplus/coc-client';
import { getCocClientFor, getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import {
    resolveCloneRoute,
    subscribeCloneBaseUrl,
    type CloneRegistryLookup,
    type CloneRouteResolution,
} from '../repos/cloneRegistry';

export const AGENT_PROVIDER_QUOTA_POLL_MS = 5 * 60 * 1000;

export interface UseAgentProvidersQuotaResult {
    quotaData: AgentProvidersQuotaResponse | null;
    loading: boolean;
    refreshing: boolean;
    error: string | null;
    refresh: (options?: { force?: boolean }) => Promise<void>;
}

export type AgentProvidersQuotaRoutingTarget = string | CloneRegistryLookup | null | undefined;

interface QuotaLoadState {
    ownerKey: string;
    quotaData: AgentProvidersQuotaResponse | null;
    loading: boolean;
    refreshing: boolean;
    error: string | null;
}

const UNRESOLVED_REMOTE_ERROR = 'Remote server route is unavailable';

function routeOwnerKey(route: CloneRouteResolution): string {
    return route.kind === 'remote' ? `remote:${route.baseUrl}` : route.kind;
}

function initialState(route: CloneRouteResolution): QuotaLoadState {
    return {
        ownerKey: routeOwnerKey(route),
        quotaData: null,
        loading: route.kind !== 'unresolved-remote',
        refreshing: false,
        error: route.kind === 'unresolved-remote' ? UNRESOLVED_REMOTE_ERROR : null,
    };
}

/**
 * Fetches and polls agent provider quota every 5 minutes.
 * Shared by AgentProviderQuotaIndicator, PauseDurationMenu, and pill controls.
 */
export function useAgentProvidersQuota(
    routingTarget?: AgentProvidersQuotaRoutingTarget,
): UseAgentProvidersQuotaResult {
    const [, setRouteVersion] = useState(0);
    const route = resolveCloneRoute(routingTarget);
    const ownerKey = routeOwnerKey(route);
    const [state, setState] = useState<QuotaLoadState>(() => initialState(route));
    const mountedRef = useRef(true);
    const requestGenerationRef = useRef(0);
    const ownerKeyRef = useRef(ownerKey);
    ownerKeyRef.current = ownerKey;
    const currentState = state.ownerKey === ownerKey ? state : initialState(route);

    const refresh = useCallback(async (options: { force?: boolean } = {}) => {
        const requestGeneration = ++requestGenerationRef.current;
        if (route.kind === 'unresolved-remote') {
            setState(initialState(route));
            return;
        }
        setState(previous => {
            const sameOwner = previous.ownerKey === ownerKey;
            const quotaData = sameOwner ? previous.quotaData : null;
            return {
                ownerKey,
                quotaData,
                loading: quotaData === null,
                refreshing: quotaData !== null,
                error: null,
            };
        });
        try {
            const client = route.kind === 'remote' ? getCocClientFor(route.baseUrl) : getSpaCocClient();
            const data = await client.admin.getAgentProvidersQuota(options.force ? { force: true } : undefined);
            if (
                !mountedRef.current
                || requestGeneration !== requestGenerationRef.current
                || ownerKeyRef.current !== ownerKey
            ) {
                return;
            }
            setState({ ownerKey, quotaData: data, loading: false, refreshing: false, error: null });
        } catch (err) {
            if (
                !mountedRef.current
                || requestGeneration !== requestGenerationRef.current
                || ownerKeyRef.current !== ownerKey
            ) {
                return;
            }
            setState(previous => ({
                ownerKey,
                quotaData: previous.ownerKey === ownerKey ? previous.quotaData : null,
                loading: false,
                refreshing: false,
                error: getSpaCocClientErrorMessage(err, 'Failed to load provider quota'),
            }));
        }
    }, [ownerKey, route.kind, route.kind === 'remote' ? route.baseUrl : undefined]);

    useEffect(() => {
        return subscribeCloneBaseUrl(routingTarget, () => setRouteVersion(version => version + 1));
    }, [routingTarget]);

    useEffect(() => {
        requestGenerationRef.current += 1;
        void refresh();
        if (route.kind === 'unresolved-remote') return;
        const timer = window.setInterval(() => void refresh(), AGENT_PROVIDER_QUOTA_POLL_MS);
        return () => window.clearInterval(timer);
    }, [ownerKey, refresh, route.kind]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestGenerationRef.current += 1;
        };
    }, []);

    return {
        quotaData: currentState.quotaData,
        loading: currentState.loading,
        refreshing: currentState.refreshing,
        error: currentState.error,
        refresh,
    };
}
