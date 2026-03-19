/**
 * useModels — fetches available models from the models endpoint.
 * Returns ModelInfo[] for interface compatibility with consumers.
 */
import { useState, useEffect } from 'react';
import { getApiBase } from '../utils/config';

export interface ModelInfo {
    id: string;
    tokenLimit: number;
    name?: string;
    // extend as ModelMetadataStore grows
}

export function useModels(): { models: ModelInfo[]; loading: boolean } {
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(getApiBase() + '/models')
            .then(r => (r.ok ? r.json() : []))
            .then((data: unknown) => {
                // /api/models returns ModelInfo[] directly
                const arr = Array.isArray(data)
                    ? data.map((m: { id: string; name?: string; capabilities?: { limits?: { max_context_window_tokens?: number } } }) => ({
                        id: m.id,
                        tokenLimit: m.capabilities?.limits?.max_context_window_tokens ?? 0,
                        name: m.name,
                    }))
                    : [];
                setModels(arr);
            })
            .catch(() => { /* silently ignore — dialogs stay functional with empty list */ })
            .finally(() => setLoading(false));
    }, []);

    return { models, loading };
}
