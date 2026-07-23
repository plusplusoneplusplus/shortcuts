/**
 * useProviderReasoningEfforts — fetches the per-model reasoning-effort
 * preference map for a given provider.
 *
 * Wraps `GET /api/agent-providers/<provider>/models/reasoning-efforts` and
 * returns the resulting `Record<modelId, effort>` map.  Both `NewChatArea`
 * and `ChatDetail` consume this hook to drive their auto-derive logic.
 *
 * Returns an empty map `{}` while the request is in flight or if the
 * endpoint returns no data (preferences are optional — a missing map just
 * means no default is set for any model).
 */
import { useState, useEffect } from 'react';
import { getCocClientFor, getSpaCocClient } from '../api/cocClient';
import { getOrFetchConfig, peekConfig, configCacheKey } from '../api/staticConfigCache';
import type { AgentProvider } from './useProviderModels';

type ReasoningEffortsResponse = { reasoningEfforts?: Record<string, string> };

function extractMap(data: ReasoningEffortsResponse | undefined): Record<string, string> {
    return data?.reasoningEfforts && typeof data.reasoningEfforts === 'object' ? data.reasoningEfforts : {};
}

/**
 * @param baseUrl Optional owning-clone remote baseUrl. When present, the map is
 *   read from that clone's server and cached under a server-scoped key so two
 *   servers sharing a provider id never share entries (AC-07 DoD #4); when
 *   omitted (local clone) the default origin client + legacy bare key are used.
 */
export function useProviderReasoningEfforts(provider: AgentProvider, baseUrl?: string): Record<string, string> {
    // Seed from the session cache so a warm reopen has the map immediately.
    const [reasoningEfforts, setReasoningEfforts] = useState<Record<string, string>>(
        () => extractMap(peekConfig<ReasoningEffortsResponse>(configCacheKey.reasoningEfforts(provider, baseUrl))),
    );

    useEffect(() => {
        const key = configCacheKey.reasoningEfforts(provider, baseUrl);
        const cached = peekConfig<ReasoningEffortsResponse>(key);
        if (cached !== undefined) {
            setReasoningEfforts(extractMap(cached));
            return;
        }
        let cancelled = false;
        getOrFetchConfig(key, () => (baseUrl ? getCocClientFor(baseUrl) : getSpaCocClient()).agentProviders.getReasoningEfforts(provider))
            .then((data: ReasoningEffortsResponse) => {
                if (cancelled) return;
                if (data?.reasoningEfforts && typeof data.reasoningEfforts === 'object') {
                    setReasoningEfforts(data.reasoningEfforts);
                }
            })
            .catch(() => { /* reasoning efforts are optional — silently ignore */ });
        return () => { cancelled = true; };
    }, [provider, baseUrl]);

    return reasoningEfforts;
}
