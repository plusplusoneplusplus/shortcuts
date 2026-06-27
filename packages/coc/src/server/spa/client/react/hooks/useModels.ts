/**
 * useModels — fetches available models from a provider's model endpoint.
 *
 * Delegates to the provider-scoped GET /api/agent-providers/:provider/models
 * endpoint. Consumers may pass an explicit provider; otherwise the dashboard's
 * active/default provider is used for backwards compatibility.
 *
 * Returns ModelInfo[] for interface compatibility with consumers.
 */
import { useState, useEffect, useCallback } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { getActiveProvider } from '../utils/config';
import { getOrFetchConfig, peekConfig, invalidateConfig, configCacheKey } from '../api/staticConfigCache';

/** Billing metadata preserved from the model catalog (e.g. tokenPrices.longContext.contextMax). */
export interface ModelBillingInfo {
    multiplier?: number;
    tokenPrices?: {
        longContext?: { contextMax?: number; [key: string]: unknown };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface ModelInfo {
    id: string;
    tokenLimit: number;
    name?: string;
    enabled: boolean;
    capabilities?: {
        supports: { vision: boolean; reasoningEffort: boolean };
        limits: { max_context_window_tokens: number; max_prompt_tokens?: number };
    };
    /** Reasoning efforts the model accepts (e.g. ['low','medium','high','xhigh']). Empty when unknown. */
    supportedReasoningEfforts: string[];
    /** Default reasoning effort the model picks when none is requested. */
    defaultReasoningEffort?: string;
    /** Billing metadata, including long-context tier support. Preserved verbatim from the catalog. */
    billing?: ModelBillingInfo;
}

interface RawModel {
    id: string;
    name?: string;
    enabled?: boolean;
    capabilities?: {
        supports?: {
            vision?: boolean;
            reasoningEffort?: boolean;
            /** Raw CAPI metadata: list of accepted reasoning_effort values. Authoritative when present. */
            reasoning_effort?: unknown;
        };
        limits?: { max_context_window_tokens?: number; max_prompt_tokens?: number };
    };
    /** SDK contract field with the supported reasoning efforts. */
    supportedReasoningEfforts?: unknown;
    defaultReasoningEffort?: unknown;
    billing?: ModelBillingInfo;
}

const KNOWN_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
type KnownReasoningEffort = typeof KNOWN_REASONING_EFFORTS[number];

function normalizeReasoningEfforts(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string') continue;
        if (!(KNOWN_REASONING_EFFORTS as readonly string[]).includes(item)) continue;
        if (seen.has(item)) continue;
        seen.add(item);
        result.push(item);
    }
    // Preserve canonical ordering for stable rendering
    return KNOWN_REASONING_EFFORTS.filter(e => seen.has(e));
}

function normalizeDefaultReasoningEffort(value: unknown, supported: string[]): string | undefined {
    if (typeof value !== 'string') return undefined;
    if (!supported.includes(value)) return undefined;
    return value as KnownReasoningEffort;
}

function mapModel(m: RawModel): ModelInfo {
    // Raw CAPI capability metadata wins over the SDK contract field — it is the
    // direct source for the values CAPI actually accepts.
    const supportedReasoningEfforts = normalizeReasoningEfforts(
        m.capabilities?.supports?.reasoning_effort ?? m.supportedReasoningEfforts,
    );
    const defaultReasoningEffort = normalizeDefaultReasoningEffort(m.defaultReasoningEffort, supportedReasoningEfforts);
    // Treat the presence of a non-empty supported list as definitive proof
    // the model exposes reasoning, even if the boolean flag is missing.
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

/** Maps a raw provider models response (`{ models }`) into ModelInfo[]. */
function mapModelsResponse(data: unknown): ModelInfo[] {
    const models = (data as { models?: unknown } | null | undefined)?.models;
    return Array.isArray(models) ? models.map(mapModel) : [];
}

/**
 * Fetches models from the active provider's catalog.
 * All model consumers (chat picker, queue dialogs, etc.) use this hook
 * so they automatically reflect the active provider's model list.
 */
export function useModels(providerOverride?: string): { models: ModelInfo[]; loading: boolean; error: string | null; reload: () => void } {
    const provider = providerOverride ?? getActiveProvider();
    const modelsKey = configCacheKey.models(provider);
    // Seed from the session cache so a warm reopen (provider already seen this
    // session) paints the catalog immediately with no loading flash.
    const [models, setModels] = useState<ModelInfo[]>(() => {
        const cached = peekConfig(modelsKey);
        return cached !== undefined ? mapModelsResponse(cached) : [];
    });
    const [loading, setLoading] = useState(() => peekConfig(modelsKey) === undefined);
    const [error, setError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);

    const load = useCallback(() => {
        // Force a fresh fetch: drop the cached response so the effect refetches.
        invalidateConfig(configCacheKey.models(provider));
        setReloadToken(token => token + 1);
    }, [provider]);

    useEffect(() => {
        const key = configCacheKey.models(provider);
        // Warm cache hit — serve synchronously without clearing models or
        // flipping to a loading state, so a conversation switch does not flash.
        const cached = peekConfig(key);
        if (cached !== undefined) {
            setModels(mapModelsResponse(cached));
            setError(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        setModels([]);
        let cancelled = false;
        getOrFetchConfig(key, () => getSpaCocClient().agentProviders.listModels(provider))
            .then((data: unknown) => {
                if (cancelled) return;
                setModels(mapModelsResponse(data));
            })
            .catch((e: unknown) => {
                if (!cancelled) setError(getSpaCocClientErrorMessage(e, 'Failed to load models'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [provider, reloadToken]);

    return { models, loading, error, reload: load };
}

/**
 * @deprecated Use useProviderModelConfig from useProviderModels.ts for
 * provider-scoped model management in the Agent Provider admin page.
 * This wrapper is kept for backward compatibility with consumers that
 * still reference useModelConfig from this module.
 */
export function useModelConfig(): {
    models: ModelInfo[];
    loading: boolean;
    error: string | null;
    saving: boolean;
    reload: () => void;
    toggleModel: (modelId: string, enabled: boolean) => Promise<void>;
    /** Per-model persisted reasoning effort overrides (modelId → effort). */
    reasoningEfforts: Record<string, string>;
    /** Persist a reasoning effort override for a model. Empty string clears it. */
    setReasoningEffort: (modelId: string, effort: string) => Promise<void>;
} {
    const { models, loading, error, reload } = useModels();
    const [localModels, setLocalModels] = useState<ModelInfo[]>([]);
    const [saving, setSaving] = useState(false);
    const [reasoningEfforts, setReasoningEfforts] = useState<Record<string, string>>({});
    const provider = getActiveProvider();

    // Keep localModels in sync with fetched models
    useEffect(() => {
        setLocalModels(models);
    }, [models]);

    // Load persisted reasoning efforts on mount (through the session cache).
    useEffect(() => {
        let cancelled = false;
        getOrFetchConfig(
            configCacheKey.reasoningEfforts(provider),
            () => getSpaCocClient().agentProviders.getReasoningEfforts(provider),
        )
            .then((data: { reasoningEfforts?: Record<string, string> }) => {
                if (cancelled) return;
                if (data?.reasoningEfforts && typeof data.reasoningEfforts === 'object') {
                    setReasoningEfforts(data.reasoningEfforts);
                }
            })
            .catch(() => { /* reasoning efforts are optional */ });
        return () => { cancelled = true; };
    }, [provider]);

    const toggleModel = useCallback(async (modelId: string, enabled: boolean) => {
        // Optimistic update
        setLocalModels(prev => prev.map(m => m.id === modelId ? { ...m, enabled } : m));
        setSaving(true);
        try {
            const updated = localModels.map(m => m.id === modelId ? { ...m, enabled } : m);
            const enabledModels = updated.filter(m => m.id === modelId ? enabled : m.enabled).map(m => m.id);
            await getSpaCocClient().agentProviders.setEnabledModels(provider, enabledModels);
            // Enabled-model set changed — drop the cached catalog so the next
            // read (e.g. the chat model picker) refetches (AC-05).
            invalidateConfig(configCacheKey.models(provider));
        } catch {
            // Revert optimistic update on error
            setLocalModels(models);
        } finally {
            setSaving(false);
        }
    }, [localModels, models, provider]);

    const setReasoningEffortFn = useCallback(async (modelId: string, effort: string) => {
        const prev = { ...reasoningEfforts };
        // Optimistic update
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
