/**
 * useProviderModels — provider-scoped model hooks.
 * Fetches model catalog, enabled/reasoning-effort state, and query
 * operations from GET /api/agent-providers/:provider/models*.
 */
import { useState, useEffect, useCallback } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';

export interface ProviderModelInfo {
    id: string;
    tokenLimit: number;
    name?: string;
    enabled: boolean;
    capabilities?: {
        supports: { vision: boolean; reasoningEffort: boolean };
        limits: { max_context_window_tokens: number; max_prompt_tokens?: number };
    };
    supportedReasoningEfforts: string[];
    defaultReasoningEffort?: string;
}

interface RawModel {
    id: string;
    name?: string;
    enabled?: boolean;
    capabilities?: {
        supports?: {
            vision?: boolean;
            reasoningEffort?: boolean;
            reasoning_effort?: unknown;
        };
        limits?: { max_context_window_tokens?: number; max_prompt_tokens?: number };
    };
    supportedReasoningEfforts?: unknown;
    defaultReasoningEffort?: unknown;
}

const KNOWN_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;

function normalizeReasoningEfforts(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item !== 'string') continue;
        if (!(KNOWN_REASONING_EFFORTS as readonly string[]).includes(item)) continue;
        seen.add(item);
    }
    return KNOWN_REASONING_EFFORTS.filter(e => seen.has(e));
}

function normalizeDefaultReasoningEffort(value: unknown, supported: string[]): string | undefined {
    if (typeof value !== 'string') return undefined;
    if (!supported.includes(value)) return undefined;
    return value;
}

function mapModel(m: RawModel): ProviderModelInfo {
    const supportedReasoningEfforts = normalizeReasoningEfforts(
        m.capabilities?.supports?.reasoning_effort ?? m.supportedReasoningEfforts,
    );
    const defaultReasoningEffort = normalizeDefaultReasoningEffort(m.defaultReasoningEffort, supportedReasoningEfforts);
    const reasoningEffort = supportedReasoningEfforts.length > 0
        ? true
        : (m.capabilities?.supports?.reasoningEffort ?? false);
    return {
        id: m.id,
        tokenLimit: m.capabilities?.limits?.max_context_window_tokens ?? 0,
        name: m.name,
        enabled: m.enabled ?? false,
        capabilities: {
            supports: {
                vision: m.capabilities?.supports?.vision ?? false,
                reasoningEffort,
            },
            limits: {
                max_context_window_tokens: m.capabilities?.limits?.max_context_window_tokens ?? 0,
                max_prompt_tokens: m.capabilities?.limits?.max_prompt_tokens,
            },
        },
        supportedReasoningEfforts,
        defaultReasoningEffort,
    };
}

export type AgentProvider = 'copilot' | 'codex' | 'claude';

export function useProviderModels(provider: AgentProvider): {
    models: ProviderModelInfo[];
    loading: boolean;
    error: string | null;
    reload: () => void;
} {
    const [models, setModels] = useState<ProviderModelInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        getSpaCocClient().agentProviders.listModels(provider)
            .then((data) => {
                const arr = Array.isArray(data?.models) ? data.models.map(mapModel) : [];
                setModels(arr);
            })
            .catch((e: unknown) => { setError(getSpaCocClientErrorMessage(e, `Failed to load ${provider} models`)); })
            .finally(() => setLoading(false));
    }, [provider]);

    useEffect(() => { load(); }, [load]);

    return { models, loading, error, reload: load };
}

export function useProviderModelConfig(provider: AgentProvider): {
    models: ProviderModelInfo[];
    loading: boolean;
    error: string | null;
    saving: boolean;
    reload: () => void;
    toggleModel: (modelId: string, enabled: boolean) => Promise<void>;
    reasoningEfforts: Record<string, string>;
    setReasoningEffort: (modelId: string, effort: string) => Promise<void>;
} {
    const { models, loading, error, reload } = useProviderModels(provider);
    const [localModels, setLocalModels] = useState<ProviderModelInfo[]>([]);
    const [saving, setSaving] = useState(false);
    const [reasoningEfforts, setReasoningEfforts] = useState<Record<string, string>>({});

    useEffect(() => {
        setLocalModels(models);
    }, [models]);

    useEffect(() => {
        getSpaCocClient().agentProviders.getReasoningEfforts(provider)
            .then((data) => {
                if (data?.reasoningEfforts && typeof data.reasoningEfforts === 'object') {
                    setReasoningEfforts(data.reasoningEfforts);
                }
            })
            .catch(() => { /* reasoning efforts are optional */ });
    }, [provider]);

    const toggleModel = useCallback(async (modelId: string, enabled: boolean) => {
        setLocalModels(prev => prev.map(m => m.id === modelId ? { ...m, enabled } : m));
        setSaving(true);
        try {
            const updated = localModels.map(m => m.id === modelId ? { ...m, enabled } : m);
            const enabledModels = updated.filter(m => m.id === modelId ? enabled : m.enabled).map(m => m.id);
            await getSpaCocClient().agentProviders.setEnabledModels(provider, enabledModels);
        } catch {
            setLocalModels(models);
        } finally {
            setSaving(false);
        }
    }, [localModels, models, provider]);

    const setReasoningEffortFn = useCallback(async (modelId: string, effort: string) => {
        const prev = { ...reasoningEfforts };
        if (effort === '') {
            const next = { ...reasoningEfforts };
            delete next[modelId];
            setReasoningEfforts(next);
        } else {
            setReasoningEfforts({ ...reasoningEfforts, [modelId]: effort });
        }
        try {
            await getSpaCocClient().agentProviders.setReasoningEffort(provider, modelId, effort);
        } catch {
            setReasoningEfforts(prev);
        }
    }, [reasoningEfforts, provider]);

    return { models: localModels, loading, error, saving, reload, toggleModel, reasoningEfforts, setReasoningEffort: setReasoningEffortFn };
}
