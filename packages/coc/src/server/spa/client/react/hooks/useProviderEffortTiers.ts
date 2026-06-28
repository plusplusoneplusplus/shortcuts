/**
 * useProviderEffortTiers — fetches and manages the per-tier effort mapping
 * for a given provider.
 *
 * The GET response always returns known tiers populated (defaults fill any tier
 * the admin has not explicitly configured), with a per-tier `source`
 * marker (`'config'` for stored entries, `'default'` for default fallbacks)
 * plus a separate `defaults` map the client can revert to.
 *
 * Local state mirrors that shape — every tier has a `source` — but the
 * baseline for dirty-tracking and the save payload only include entries the
 * user has actually saved (`source: 'config'`). Untouched defaults are never
 * persisted, so future default changes flow through and unknown default
 * models do not block save.
 *
 * Clearing a configured tier reverts it to its provider default (defaults
 * always exist for known providers).
 */
import { useState, useEffect, useCallback } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { getOrFetchConfig, peekConfig, invalidateConfig, configCacheKey } from '../api/staticConfigCache';
import type { AgentProvider } from './useProviderModels';

export type EffortTierKey = 'very-low' | 'low' | 'medium' | 'high';
export type EffortTierSource = 'config' | 'default';

export interface LocalTierEntry {
    model: string;
    /** Empty string = Auto / no preference (maps to null in the API). */
    reasoningEffort: string;
    /** `'config'` = user-saved; `'default'` = hardcoded provider default surfaced by GET. */
    source: EffortTierSource;
}

export type LocalEffortTiersMap = Partial<Record<EffortTierKey, LocalTierEntry>>;

type ServerTierEntry = { model: string; reasoningEffort?: string | null; source?: EffortTierSource };
type ServerTierMap = Partial<Record<EffortTierKey, ServerTierEntry>>;
type DefaultsMap = Partial<Record<EffortTierKey, { model: string; reasoningEffort: string | null }>>;

export interface UseProviderEffortTiersResult {
    /** Current local (possibly edited) tier state. Always populated for known providers. */
    tiers: LocalEffortTiersMap;
    loading: boolean;
    error: string | null;
    saveError: string | null;
    saving: boolean;
    dirty: boolean;
    /** Sets a tier explicitly (marks it as `source: 'config'`). */
    setTier: (tier: EffortTierKey, model: string, reasoningEffort: string) => void;
    /**
     * Reverts a tier to its provider default. If no default exists for the
     * provider (unknown provider), the row is removed entirely.
     */
    clearTier: (tier: EffortTierKey) => void;
    save: () => Promise<void>;
    cancel: () => void;
    reload: () => void;
}

export const TIER_KEYS: readonly EffortTierKey[] = ['very-low', 'low', 'medium', 'high'];

function normalizeFromServer(raw: ServerTierMap = {}): LocalEffortTiersMap {
    const result: LocalEffortTiersMap = {};
    for (const key of TIER_KEYS) {
        const entry = raw[key];
        if (entry?.model) {
            result[key] = {
                model: entry.model,
                reasoningEffort: entry.reasoningEffort ?? '',
                source: entry.source ?? 'config',
            };
        }
    }
    return result;
}

/** Compares only the `source: 'config'` entries — defaults are not persisted. */
function configEntriesEqual(a: LocalEffortTiersMap, b: LocalEffortTiersMap): boolean {
    for (const k of TIER_KEYS) {
        const ae = a[k]?.source === 'config' ? a[k] : undefined;
        const be = b[k]?.source === 'config' ? b[k] : undefined;
        if (!ae && !be) continue;
        if (!ae || !be) return false;
        if (ae.model !== be.model || ae.reasoningEffort !== be.reasoningEffort) return false;
    }
    return true;
}

export function useProviderEffortTiers(provider: AgentProvider): UseProviderEffortTiersResult {
    /** Latest server snapshot (merged defaults + config). Baseline for dirty/cancel. */
    const [remote, setRemote] = useState<LocalEffortTiersMap>({});
    const [local, setLocal] = useState<LocalEffortTiersMap>({});
    const [defaults, setDefaults] = useState<DefaultsMap>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        const key = configCacheKey.effortTiers(provider);
        // Warm cache hit — apply synchronously without a loading flash.
        const cached = peekConfig<{ effortTiers?: ServerTierMap; defaults?: DefaultsMap }>(key);
        if (cached !== undefined) {
            const normalized = normalizeFromServer(cached.effortTiers as ServerTierMap);
            setRemote(normalized);
            setLocal(normalized);
            setDefaults((cached.defaults ?? {}) as DefaultsMap);
            setLoading(false);
            setError(null);
            setSaveError(null);
            return;
        }
        setLoading(true);
        setError(null);
        setSaveError(null);
        getOrFetchConfig(key, () => getSpaCocClient().agentProviders.getEffortTiers(provider))
            .then((data) => {
                const normalized = normalizeFromServer(data.effortTiers as ServerTierMap);
                setRemote(normalized);
                setLocal(normalized);
                setDefaults((data.defaults ?? {}) as DefaultsMap);
            })
            .catch((e: unknown) => {
                setError(getSpaCocClientErrorMessage(e, 'Failed to load effort tiers'));
            })
            .finally(() => setLoading(false));
    }, [provider]);

    useEffect(() => { load(); }, [load]);

    /** Explicit reload: drop the cached tiers first so the fetch is fresh. */
    const reload = useCallback(() => {
        invalidateConfig(configCacheKey.effortTiers(provider));
        load();
    }, [provider, load]);

    const setTier = useCallback((tier: EffortTierKey, model: string, reasoningEffort: string) => {
        setLocal(prev => ({ ...prev, [tier]: { model, reasoningEffort, source: 'config' } }));
    }, []);

    const clearTier = useCallback((tier: EffortTierKey) => {
        setLocal(prev => {
            const next = { ...prev };
            const defaultEntry = defaults[tier];
            if (defaultEntry) {
                next[tier] = {
                    model: defaultEntry.model,
                    reasoningEffort: defaultEntry.reasoningEffort ?? '',
                    source: 'default',
                };
            } else {
                delete next[tier];
            }
            return next;
        });
    }, [defaults]);

    const save = useCallback(async () => {
        setSaving(true);
        setSaveError(null);
        try {
            // Only persist tiers the user explicitly configured. Untouched
            // defaults are intentionally omitted from the payload.
            const map: Partial<Record<EffortTierKey, { model: string; reasoningEffort: string | null }>> = {};
            for (const tier of TIER_KEYS) {
                const entry = local[tier];
                if (entry?.model && entry.source === 'config') {
                    map[tier] = { model: entry.model, reasoningEffort: entry.reasoningEffort || null };
                }
            }
            const response = await getSpaCocClient().agentProviders.replaceEffortTiers(provider, map);
            // Settings mutation — drop the cached tiers so other mounts refetch (AC-05).
            invalidateConfig(configCacheKey.effortTiers(provider));
            const normalized = normalizeFromServer(response.effortTiers as ServerTierMap);
            setRemote(normalized);
            setLocal(normalized);
            setDefaults(((response as { defaults?: DefaultsMap }).defaults ?? {}) as DefaultsMap);
        } catch (e: unknown) {
            setSaveError(getSpaCocClientErrorMessage(e, 'Failed to save effort tiers'));
        } finally {
            setSaving(false);
        }
    }, [provider, local]);

    const cancel = useCallback(() => {
        setLocal(remote);
        setSaveError(null);
    }, [remote]);

    const dirty = !configEntriesEqual(remote, local);

    return { tiers: local, loading, error, saveError, saving, dirty, setTier, clearTier, save, cancel, reload };
}
