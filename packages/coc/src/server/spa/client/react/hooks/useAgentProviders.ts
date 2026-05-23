/**
 * useAgentProviders — fetches live agent provider status from GET /api/agent-providers.
 * Copilot is always available; Codex availability depends on admin config + auth state.
 */
import { useState, useEffect, useCallback } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import type { AgentProviderStatus } from '@plusplusoneplusplus/coc-client';

export type { AgentProviderStatus };

export interface UseAgentProvidersResult {
    providers: AgentProviderStatus[];
    loading: boolean;
    error: string | null;
    reload: () => void;
    /** Convenience: the Copilot provider entry (always present). */
    copilot: AgentProviderStatus | undefined;
    /** Convenience: the Codex provider entry (present even when disabled). */
    codex: AgentProviderStatus | undefined;
}

const COPILOT_FALLBACK: AgentProviderStatus = {
    id: 'copilot',
    label: 'Copilot',
    enabled: true,
    available: true,
    locked: true,
};

export function useAgentProviders(): UseAgentProvidersResult {
    const [providers, setProviders] = useState<AgentProviderStatus[]>([COPILOT_FALLBACK]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        getSpaCocClient().agentProviders.list()
            .then((data) => {
                if (data?.providers && data.providers.length > 0) {
                    setProviders(data.providers);
                }
            })
            .catch((e: unknown) => {
                // Non-fatal: keep Copilot fallback, show warning
                setError(getSpaCocClientErrorMessage(e, 'Failed to load agent providers'));
            })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    const copilot = providers.find(p => p.id === 'copilot');
    const codex = providers.find(p => p.id === 'codex');

    return { providers, loading, error, reload: load, copilot, codex };
}
