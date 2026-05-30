/**
 * useProviderEffortTiers — fetches and manages the per-tier effort mapping
 * for a given provider.
 *
 * Wraps GET/PUT /api/agent-providers/<provider>/effort-tiers and exposes
 * local draft state with dirty tracking and save/cancel semantics.
 */
import { useState, useEffect, useCallback } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import type { AgentProvider } from './useProviderModels';

export type EffortTierKey = 'low' | 'medium' | 'high';

export interface LocalTierEntry {
    model: string;
    /** Empty string = Auto / no preference (maps to null in the API). */
    reasoningEffort: string;
}

export type LocalEffortTiersMap = Partial<Record<EffortTierKey, LocalTierEntry>>;

export interface UseProviderEffortTiersResult {
    /** Current local (possibly edited) tier state. */
    tiers: LocalEffortTiersMap;
    loading: boolean;
    error: string | null;
    saveError: string | null;
    saving: boolean;
    dirty: boolean;
    setTier: (tier: EffortTierKey, model: string, reasoningEffort: string) => void;
    clearTier: (tier: EffortTierKey) => void;
    save: () => Promise<void>;
    cancel: () => void;
    reload: () => void;
}

function normalizeFromServer(
    raw: Partial<Record<EffortTierKey, { model: string; reasoningEffort?: string | null }>> = {},
): LocalEffortTiersMap {
    const result: LocalEffortTiersMap = {};
    for (const key of (['low', 'medium', 'high'] as EffortTierKey[])) {
        const entry = raw[key];
        if (entry?.model) {
            result[key] = {
                model: entry.model,
                reasoningEffort: entry.reasoningEffort ?? '',
            };
        }
    }
    return result;
}

function tiersEqual(a: LocalEffortTiersMap, b: LocalEffortTiersMap): boolean {
    const keys: EffortTierKey[] = ['low', 'medium', 'high'];
    for (const k of keys) {
        const ae = a[k];
        const be = b[k];
        if (!ae && !be) continue;
        if (!ae || !be) return false;
        if (ae.model !== be.model || ae.reasoningEffort !== be.reasoningEffort) return false;
    }
    return true;
}

export function useProviderEffortTiers(provider: AgentProvider): UseProviderEffortTiersResult {
    const [remote, setRemote] = useState<LocalEffortTiersMap>({});
    const [local, setLocal] = useState<LocalEffortTiersMap>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        setSaveError(null);
        getSpaCocClient().agentProviders.getEffortTiers(provider)
            .then((data) => {
                const normalized = normalizeFromServer(
                    data.effortTiers as Partial<Record<EffortTierKey, { model: string; reasoningEffort?: string | null }>>,
                );
                setRemote(normalized);
                setLocal(normalized);
            })
            .catch((e: unknown) => {
                setError(getSpaCocClientErrorMessage(e, 'Failed to load effort tiers'));
            })
            .finally(() => setLoading(false));
    }, [provider]);

    useEffect(() => { load(); }, [load]);

    const setTier = useCallback((tier: EffortTierKey, model: string, reasoningEffort: string) => {
        setLocal(prev => ({ ...prev, [tier]: { model, reasoningEffort } }));
    }, []);

    const clearTier = useCallback((tier: EffortTierKey) => {
        setLocal(prev => {
            const next = { ...prev };
            delete next[tier];
            return next;
        });
    }, []);

    const save = useCallback(async () => {
        setSaving(true);
        setSaveError(null);
        try {
            const map: Partial<Record<EffortTierKey, { model: string; reasoningEffort: string | null }>> = {};
            for (const tier of (['low', 'medium', 'high'] as EffortTierKey[])) {
                const entry = local[tier];
                if (entry?.model) {
                    map[tier] = { model: entry.model, reasoningEffort: entry.reasoningEffort || null };
                }
            }
            const response = await (getSpaCocClient().agentProviders as any).replaceEffortTiers(provider, map);
            const normalized = normalizeFromServer(
                response.effortTiers as Partial<Record<EffortTierKey, { model: string; reasoningEffort?: string | null }>>,
            );
            setRemote(normalized);
            setLocal(normalized);
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

    const dirty = !tiersEqual(remote, local);

    return { tiers: local, loading, error, saveError, saving, dirty, setTier, clearTier, save, cancel, reload: load };
}
