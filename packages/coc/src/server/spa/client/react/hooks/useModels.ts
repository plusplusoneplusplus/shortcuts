/**
 * useModels — fetches the server's model registry once and memoises the result.
 * Returns ModelInfo[] (id + tokenLimit + any other metadata from ModelMetadataStore).
 */
import { useState, useEffect } from 'react';
import { fetchApi } from './useApi';

export interface ModelInfo {
    id: string;
    tokenLimit: number;
    // extend as ModelMetadataStore grows
}

export function useModels(): { models: ModelInfo[]; loading: boolean } {
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchApi('/models')
            .then((data: ModelInfo[]) => setModels(Array.isArray(data) ? data : []))
            .catch(() => { /* silently ignore — dialogs stay functional with empty list */ })
            .finally(() => setLoading(false));
    }, []);

    return { models, loading };
}
