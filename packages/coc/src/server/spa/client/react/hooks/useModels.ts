/**
 * useModels — fetches available models from the models endpoint.
 * Returns ModelInfo[] for interface compatibility with consumers.
 */
import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../utils/config';

export interface ModelInfo {
    id: string;
    tokenLimit: number;
    name?: string;
    capabilities?: {
        supports: { vision: boolean; reasoningEffort: boolean };
        limits: { max_context_window_tokens: number; max_prompt_tokens?: number };
    };
}

interface RawModel {
    id: string;
    name?: string;
    capabilities?: {
        supports?: { vision?: boolean; reasoningEffort?: boolean };
        limits?: { max_context_window_tokens?: number; max_prompt_tokens?: number };
    };
}

function mapModel(m: RawModel): ModelInfo {
    return {
        id: m.id,
        tokenLimit: m.capabilities?.limits?.max_context_window_tokens ?? 0,
        name: m.name,
        capabilities: {
            supports: {
                vision: m.capabilities?.supports?.vision ?? false,
                reasoningEffort: m.capabilities?.supports?.reasoningEffort ?? false,
            },
            limits: {
                max_context_window_tokens: m.capabilities?.limits?.max_context_window_tokens ?? 0,
                max_prompt_tokens: m.capabilities?.limits?.max_prompt_tokens,
            },
        },
    };
}

export function useModels(): { models: ModelInfo[]; loading: boolean; error: string | null; reload: () => void } {
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        fetch(getApiBase() + '/models')
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then((data: unknown) => {
                const arr = Array.isArray(data) ? data.map(mapModel) : [];
                setModels(arr);
            })
            .catch((e) => { setError(e?.message ?? 'Failed to load models'); })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    return { models, loading, error, reload: load };
}
