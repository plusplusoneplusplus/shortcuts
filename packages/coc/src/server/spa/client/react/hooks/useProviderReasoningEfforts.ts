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
import { getSpaCocClient } from '../api/cocClient';
import type { AgentProvider } from './useProviderModels';

export function useProviderReasoningEfforts(provider: AgentProvider): Record<string, string> {
    const [reasoningEfforts, setReasoningEfforts] = useState<Record<string, string>>({});

    useEffect(() => {
        let cancelled = false;
        getSpaCocClient().agentProviders.getReasoningEfforts(provider)
            .then((data: { reasoningEfforts?: Record<string, string> }) => {
                if (cancelled) return;
                if (data?.reasoningEfforts && typeof data.reasoningEfforts === 'object') {
                    setReasoningEfforts(data.reasoningEfforts);
                }
            })
            .catch(() => { /* reasoning efforts are optional — silently ignore */ });
        return () => { cancelled = true; };
    }, [provider]);

    return reasoningEfforts;
}
