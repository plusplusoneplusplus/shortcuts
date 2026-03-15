/**
 * useModels — fetches available model IDs from the queue endpoint.
 * Returns ModelInfo[] for interface compatibility with consumers.
 */
import { useState, useEffect } from 'react';
import { getApiBase } from '../utils/config';

export interface ModelInfo {
    id: string;
    tokenLimit: number;
    // extend as ModelMetadataStore grows
}

export function useModels(): { models: ModelInfo[]; loading: boolean } {
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(getApiBase() + '/queue/models')
            .then(r => (r.ok ? r.json() : { models: [] }))
            .then((data: { models: string[] }) => {
                const arr = Array.isArray(data?.models)
                    ? data.models.map(id => ({ id, tokenLimit: 0 }))
                    : [];
                setModels(arr);
            })
            .catch(() => { /* silently ignore — dialogs stay functional with empty list */ })
            .finally(() => setLoading(false));
    }, []);

    return { models, loading };
}
