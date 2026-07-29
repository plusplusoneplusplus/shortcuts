/**
 * useDreamsAdminConfig — controller for the admin Dreams tab (Knowledge nav
 * group).
 *
 * Owns the global Dreams config form (enable, provider, model, idle-check
 * interval, run timeout), its dirty snapshot, the save/cancel handlers, and the
 * provider-activity feed shown alongside the config. The Dreams config loads
 * with the rest of the admin config, so `hydrate` is called from the shared
 * config loader.
 */
import { useCallback, useEffect, useState } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { invalidateDisplaySettings } from '../hooks/preferences/useDisplaySettings';
import { applyRuntimeConfigPatch } from '../utils/config';
import { loadDreamProviderActivity, type AgentProviderWorkActivity } from '../shared/providerActivity';
import type { DreamsConfigForm } from '../features/dreams/DreamsView';

const EMPTY_DREAMS: DreamsConfigForm = { enabled: false, provider: '', model: '', timeoutMinutes: '60', intervalMinutes: '5' };

export interface UseDreamsAdminConfigOptions {
    addToast: (message: string, type: 'success' | 'error') => void;
    /** True while the Dreams admin tab is active and provider activity should auto-load. */
    activityActive: boolean;
}

export function useDreamsAdminConfig({ addToast, activityActive }: UseDreamsAdminConfigOptions) {
    const [dreamsForm, setDreamsForm] = useState<DreamsConfigForm>(EMPTY_DREAMS);
    const [dreamsSnapshot, setDreamsSnapshot] = useState<DreamsConfigForm>(EMPTY_DREAMS);
    const [dreamsSaving, setDreamsSaving] = useState(false);
    const [dreamProviderActivity, setDreamProviderActivity] = useState<AgentProviderWorkActivity[]>([]);
    const [dreamProviderActivityError, setDreamProviderActivityError] = useState<string | null>(null);

    /** Loads the Dreams config form + dirty snapshot from a freshly-fetched resolved config. */
    const hydrate = useCallback((resolved: any) => {
        const loadedDreams: DreamsConfigForm = {
            enabled: resolved.dreams?.enabled ?? false,
            provider: resolved.dreams?.provider === 'codex' || resolved.dreams?.provider === 'claude' || resolved.dreams?.provider === 'copilot'
                ? resolved.dreams.provider
                : '',
            model: resolved.dreams?.model ?? '',
            timeoutMinutes: String(Math.round((resolved.dreams?.timeoutMs ?? 3_600_000) / 60_000)),
            intervalMinutes: String(Math.round((resolved.dreams?.idleCheckIntervalMs ?? 5 * 60 * 1000) / 60_000)),
        };
        setDreamsForm(loadedDreams);
        setDreamsSnapshot(loadedDreams);
    }, []);

    const dreamsDirty = dreamsForm.enabled !== dreamsSnapshot.enabled ||
        dreamsForm.provider !== dreamsSnapshot.provider ||
        dreamsForm.model !== dreamsSnapshot.model ||
        dreamsForm.timeoutMinutes !== dreamsSnapshot.timeoutMinutes ||
        dreamsForm.intervalMinutes !== dreamsSnapshot.intervalMinutes;

    const handleSaveDreams = useCallback(async () => {
        const intervalMinutes = Number(dreamsForm.intervalMinutes);
        if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
            addToast('Dreams idle check interval must be a positive whole number of minutes', 'error');
            return;
        }
        const timeoutMinutes = Number(dreamsForm.timeoutMinutes);
        if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1) {
            addToast('Dreams run timeout must be a positive whole number of minutes', 'error');
            return;
        }
        setDreamsSaving(true);
        try {
            await getSpaCocClient().admin.updateConfig({
                'dreams.enabled': dreamsForm.enabled,
                'dreams.provider': dreamsForm.provider || null,
                'dreams.model': dreamsForm.model.trim() || null,
                'dreams.idleCheckIntervalMs': intervalMinutes * 60_000,
                'dreams.timeoutMs': timeoutMinutes * 60_000,
            });
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
            applyRuntimeConfigPatch({ dreamsEnabled: dreamsForm.enabled });
            setDreamsSnapshot({ ...dreamsForm });
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setDreamsSaving(false);
        }
    }, [dreamsForm, addToast]);

    const handleCancelDreams = useCallback(() => {
        setDreamsForm({ ...dreamsSnapshot });
    }, [dreamsSnapshot]);

    const refreshDreamProviderActivity = useCallback(async () => {
        setDreamProviderActivityError(null);
        try {
            setDreamProviderActivity(await loadDreamProviderActivity());
        } catch (err: unknown) {
            setDreamProviderActivityError(getSpaCocClientErrorMessage(err, 'Failed to fetch Dreams provider activity'));
        }
    }, []);

    // Dreams provider activity lives in the admin Dreams tab; auto-load it
    // whenever that tab becomes the active dashboard route.
    useEffect(() => {
        if (!activityActive) return;
        void refreshDreamProviderActivity();
    }, [activityActive, refreshDreamProviderActivity]);

    return {
        dreamsForm, setDreamsForm,
        dreamsDirty, dreamsSaving,
        handleSaveDreams, handleCancelDreams,
        dreamProviderActivity, dreamProviderActivityError, refreshDreamProviderActivity,
        hydrate,
    };
}

export type DreamsAdminConfig = ReturnType<typeof useDreamsAdminConfig>;
