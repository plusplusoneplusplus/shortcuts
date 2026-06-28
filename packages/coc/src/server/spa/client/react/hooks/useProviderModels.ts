/**
 * useProviderModels — provider-scoped model hooks.
 * Fetches model catalog, enabled/reasoning-effort state, and query
 * operations from GET /api/agent-providers/:provider/models*.
 */
import { useState, useEffect, useCallback } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { getOrFetchConfig, peekConfig, invalidateConfig, configCacheKey } from '../api/staticConfigCache';

/** Billing metadata preserved from the model catalog (e.g. tokenPrices.longContext.contextMax). */
export interface ProviderModelBillingInfo {
    multiplier?: number;
    tokenPrices?: {
        longContext?: { contextMax?: number; [key: string]: unknown };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

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
    /** Billing metadata, including long-context tier support. Preserved verbatim from the catalog. */
    billing?: ProviderModelBillingInfo;
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
    billing?: ProviderModelBillingInfo;
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
        // Preserve billing metadata (long-context tier support) for future consumers.
        ...(m.billing !== undefined ? { billing: m.billing } : {}),
    };
}

/** Maps a raw provider models response (`{ models }`) into ProviderModelInfo[]. */
function mapModelsResponse(data: unknown): ProviderModelInfo[] {
    const models = (data as { models?: unknown } | null | undefined)?.models;
    return Array.isArray(models) ? models.map(mapModel) : [];
}

export type AgentProvider = 'copilot' | 'codex' | 'claude';

export function useProviderModels(provider: AgentProvider): {
    models: ProviderModelInfo[];
    loading: boolean;
    error: string | null;
    reload: () => void;
} {
    const modelsKey = configCacheKey.models(provider);
    // Seed from the session cache so a warm reopen paints with no loading flash.
    const [models, setModels] = useState<ProviderModelInfo[]>(() => {
        const cached = peekConfig(modelsKey);
        return cached !== undefined ? mapModelsResponse(cached) : [];
    });
    const [loading, setLoading] = useState(() => peekConfig(modelsKey) === undefined);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        const key = configCacheKey.models(provider);
        const cached = peekConfig(key);
        if (cached !== undefined) {
            setModels(mapModelsResponse(cached));
            setError(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        getOrFetchConfig(key, () => getSpaCocClient().agentProviders.listModels(provider))
            .then((data: unknown) => {
                setModels(mapModelsResponse(data));
            })
            .catch((e: unknown) => { setError(getSpaCocClientErrorMessage(e, `Failed to load ${provider} models`)); })
            .finally(() => setLoading(false));
    }, [provider]);

    useEffect(() => { load(); }, [load]);

    /** Explicit reload: drop the cached catalog first so the fetch is fresh. */
    const reload = useCallback(() => {
        invalidateConfig(configCacheKey.models(provider));
        load();
    }, [provider, load]);

    return { models, loading, error, reload };
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
        let cancelled = false;
        getOrFetchConfig(
            configCacheKey.reasoningEfforts(provider),
            () => getSpaCocClient().agentProviders.getReasoningEfforts(provider),
        )
            .then((data) => {
                if (cancelled) return;
                if (data?.reasoningEfforts && typeof data.reasoningEfforts === 'object') {
                    setReasoningEfforts(data.reasoningEfforts);
                }
            })
            .catch(() => { /* reasoning efforts are optional */ });
        return () => { cancelled = true; };
    }, [provider]);

    const toggleModel = useCallback(async (modelId: string, enabled: boolean) => {
        setLocalModels(prev => prev.map(m => m.id === modelId ? { ...m, enabled } : m));
        setSaving(true);
        try {
            const updated = localModels.map(m => m.id === modelId ? { ...m, enabled } : m);
            const enabledModels = updated.filter(m => m.id === modelId ? enabled : m.enabled).map(m => m.id);
            await getSpaCocClient().agentProviders.setEnabledModels(provider, enabledModels);
            // Enabled-model set changed — drop the cached catalog so other
            // consumers (e.g. the chat model picker) refetch (AC-05).
            invalidateConfig(configCacheKey.models(provider));
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
            // Reasoning-effort map changed — drop the cached map so the next
            // read refetches (AC-05).
            invalidateConfig(configCacheKey.reasoningEfforts(provider));
        } catch {
            setReasoningEfforts(prev);
        }
    }, [reasoningEfforts, provider]);

    return { models: localModels, loading, error, saving, reload, toggleModel, reasoningEfforts, setReasoningEffort: setReasoningEffortFn };
}
