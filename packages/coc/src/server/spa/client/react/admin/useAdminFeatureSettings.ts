/**
 * useAdminFeatureSettings — controller for the registry-driven "Workspace
 * Features" card.
 *
 * Owns the current + last-saved feature values (keyed by flat config key, e.g.
 * 'cron.enabled'), the live search string, per-card saving/dirty state, the
 * runtime-config patch on save. Rows, dirty
 * state, and the save payload all derive from the admin setting registry —
 * adding a setting there with `ui` metadata surfaces it with no per-setting
 * code here.
 */
import { useCallback, useEffect, useState } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { invalidateDisplaySettings } from '../hooks/preferences/useDisplaySettings';
import { applyRuntimeConfigPatch } from '../utils/config';
import {
    ADMIN_SETTING_DEFINITIONS,
    getFeatureSettingTab,
    readAdminSettingValue,
    type FeatureSettingTab,
    type AdminSettingDefinition,
} from '../../../../../config/admin-setting-definitions';

export type FeatureValues = Record<string, boolean | string>;

export const FEATURES_CARD_SETTINGS: readonly AdminSettingDefinition[] =
    ADMIN_SETTING_DEFINITIONS.filter(def => def.ui !== undefined);

export function readFeatureValues(resolved: unknown): FeatureValues {
    const values: FeatureValues = {};
    for (const def of FEATURES_CARD_SETTINGS) {
        values[def.key] = readAdminSettingValue(def, resolved) as boolean | string;
    }
    return values;
}

export function readRuntimeFeatureValues(values: FeatureValues): Record<string, unknown> {
    const runtimeValues: Record<string, unknown> = {};
    for (const def of FEATURES_CARD_SETTINGS) {
        if (def.runtimeFlag) runtimeValues[def.runtimeFlag] = values[def.key];
    }
    return runtimeValues;
}

/** Registry `ui` settings placed on the given settings tab. */
export function getTabFeatureSettings(tab: FeatureSettingTab): readonly AdminSettingDefinition[] {
    return FEATURES_CARD_SETTINGS.filter(def => getFeatureSettingTab(def) === tab);
}

export interface UseAdminFeatureSettingsOptions {
    addToast: (message: string, type: 'success' | 'error') => void;
    /** True while the Features sub-tab is the visible section (drives the search reset). */
    searchActive: boolean;
}

export interface AdminFeatureSettings {
    featureValues: FeatureValues;
    setFeatureValues: React.Dispatch<React.SetStateAction<FeatureValues>>;
    featureSearch: string;
    setFeatureSearch: React.Dispatch<React.SetStateAction<string>>;
    featuresSaving: boolean;
    featuresDirty: boolean;
    handleSaveFeatures: () => Promise<void>;
    handleCancelFeatures: () => void;
    /** True when any toggle placed on `tab` differs from its last-saved value. */
    isTabDirty: (tab: FeatureSettingTab) => boolean;
    /** The tab whose feature section is currently saving, or null. */
    savingTab: FeatureSettingTab | null;
    /** Saves only the keys placed on `tab`; edits on other tabs stay pending. */
    handleSaveTab: (tab: FeatureSettingTab) => Promise<void>;
    /** Reverts only the keys placed on `tab`; edits on other tabs are kept. */
    handleCancelTab: (tab: FeatureSettingTab) => void;
    /** Loads current + snapshot values from a freshly-fetched resolved config. */
    hydrate: (resolved: unknown) => void;
}

export function useAdminFeatureSettings(options: UseAdminFeatureSettingsOptions): AdminFeatureSettings {
    const { addToast, searchActive } = options;
    const [featureValues, setFeatureValues] = useState<FeatureValues>(() => readFeatureValues(undefined));
    const [featuresSnapshot, setFeaturesSnapshot] = useState<FeatureValues>(() => readFeatureValues(undefined));
    // Live search/filter for the Workspace Features card. Local UI state only —
    // never persisted, never part of the save payload, and not counted toward
    // dirty state. Reset whenever the Features sub-tab is left so it does not
    // linger when the user switches away and back (or navigates away).
    const [featureSearch, setFeatureSearch] = useState('');
    const [featuresSaving, setFeaturesSaving] = useState(false);

    useEffect(() => {
        if (!searchActive) setFeatureSearch('');
    }, [searchActive]);

    const hydrate = useCallback((resolved: unknown) => {
        const loaded = readFeatureValues(resolved);
        setFeatureValues(loaded);
        setFeaturesSnapshot(loaded);
    }, []);

    const featuresDirty = FEATURES_CARD_SETTINGS.some(def => featureValues[def.key] !== featuresSnapshot[def.key]);

    const handleSaveFeatures = useCallback(async () => {
        setFeaturesSaving(true);
        try {
            await getSpaCocClient().admin.updateConfig({ ...featureValues });
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
            applyRuntimeConfigPatch(readRuntimeFeatureValues(featureValues));
            setFeaturesSnapshot({ ...featureValues });
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setFeaturesSaving(false);
        }
    }, [featureValues, addToast]);

    const handleCancelFeatures = useCallback(() => {
        setFeatureValues({ ...featuresSnapshot });
    }, [featuresSnapshot]);

    // Per-tab feature sections share this one value map, so each section only
    // saves/reverts its own keys and never touches pending edits on other tabs.
    const [savingTab, setSavingTab] = useState<FeatureSettingTab | null>(null);

    const isTabDirty = useCallback(
        (tab: FeatureSettingTab) => getTabFeatureSettings(tab).some(def => featureValues[def.key] !== featuresSnapshot[def.key]),
        [featureValues, featuresSnapshot],
    );

    const handleSaveTab = useCallback(async (tab: FeatureSettingTab) => {
        const defs = getTabFeatureSettings(tab);
        const saved: FeatureValues = {};
        for (const def of defs) saved[def.key] = featureValues[def.key];
        setSavingTab(tab);
        try {
            await getSpaCocClient().admin.updateConfig({ ...saved });
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
            const runtimeValues: Record<string, unknown> = {};
            for (const def of defs) {
                if (def.runtimeFlag) runtimeValues[def.runtimeFlag] = saved[def.key];
            }
            applyRuntimeConfigPatch(runtimeValues);
            setFeaturesSnapshot(prev => ({ ...prev, ...saved }));
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setSavingTab(null);
        }
    }, [featureValues, addToast]);

    const handleCancelTab = useCallback((tab: FeatureSettingTab) => {
        const reverted: FeatureValues = {};
        for (const def of getTabFeatureSettings(tab)) reverted[def.key] = featuresSnapshot[def.key];
        setFeatureValues(prev => ({ ...prev, ...reverted }));
    }, [featuresSnapshot]);

    return {
        featureValues,
        setFeatureValues,
        featureSearch,
        setFeatureSearch,
        featuresSaving,
        featuresDirty,
        handleSaveFeatures,
        handleCancelFeatures,
        isTabDirty,
        savingTab,
        handleSaveTab,
        handleCancelTab,
        hydrate,
    };
}
