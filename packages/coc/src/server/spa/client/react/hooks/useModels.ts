/**
 * useModels — fetches available models from the models endpoint.
 * Returns ModelInfo[] for interface compatibility with consumers.
 */
import { useState, useEffect, useCallback } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';

export interface ModelInfo {
    id: string;
    tokenLimit: number;
    name?: string;
    enabled: boolean;
    capabilities?: {
        supports: { vision: boolean; reasoningEffort: boolean };
        limits: { max_context_window_tokens: number; max_prompt_tokens?: number };
    };
}

interface RawModel {
    id: string;
    name?: string;
    enabled?: boolean;
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
        enabled: m.enabled ?? false,
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
        getSpaCocClient().models.list()
            .then((data: unknown) => {
                const arr = Array.isArray(data) ? data.map(mapModel) : [];
                setModels(arr);
            })
            .catch((e: unknown) => { setError(getSpaCocClientErrorMessage(e, 'Failed to load models')); })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    return { models, loading, error, reload: load };
}

export function useModelConfig(): {
    models: ModelInfo[];
    loading: boolean;
    error: string | null;
    saving: boolean;
    reload: () => void;
    toggleModel: (modelId: string, enabled: boolean) => Promise<void>;
} {
    const { models, loading, error, reload } = useModels();
    const [localModels, setLocalModels] = useState<ModelInfo[]>([]);
    const [saving, setSaving] = useState(false);

    // Keep localModels in sync with fetched models
    useEffect(() => {
        setLocalModels(models);
    }, [models]);

    const toggleModel = useCallback(async (modelId: string, enabled: boolean) => {
        // Optimistic update
        setLocalModels(prev => prev.map(m => m.id === modelId ? { ...m, enabled } : m));
        setSaving(true);
        try {
            const updated = localModels.map(m => m.id === modelId ? { ...m, enabled } : m);
            const enabledModels = updated.filter(m => m.id === modelId ? enabled : m.enabled).map(m => m.id);
            await getSpaCocClient().models.setEnabled(enabledModels);
        } catch {
            // Revert optimistic update on error
            setLocalModels(models);
        } finally {
            setSaving(false);
        }
    }, [localModels, models]);

    return { models: localModels, loading, error, saving, reload, toggleModel };
}
