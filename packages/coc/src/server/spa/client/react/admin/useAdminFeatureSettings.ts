/**
 * useAdminFeatureSettings — controller for the registry-driven "Workspace
 * Features" card.
 *
 * Owns the current + last-saved feature values (keyed by flat config key, e.g.
 * 'loops.enabled'), the live search string, per-card saving/dirty state, the
 * runtime-config patch on save, and the Ctrl/Cmd+S save shortcut. Rows, dirty
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
    readAdminSettingValue,
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

export interface UseAdminFeatureSettingsOptions {
    addToast: (message: string, type: 'success' | 'error') => void;
    /** True while the Features sub-tab is the visible section (drives the search reset). */
    searchActive: boolean;
    /** True while the Features card is focused and the Ctrl/Cmd+S shortcut should fire. */
    shortcutActive: boolean;
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
    /** Loads current + snapshot values from a freshly-fetched resolved config. */
    hydrate: (resolved: unknown) => void;
}

export function useAdminFeatureSettings(options: UseAdminFeatureSettingsOptions): AdminFeatureSettings {
    const { addToast, searchActive, shortcutActive } = options;
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

    useEffect(() => {
        if (!shortcutActive) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                !(event.ctrlKey || event.metaKey)
                || event.altKey
                || event.shiftKey
                || event.key.toLowerCase() !== 's'
            ) {
                return;
            }

            event.preventDefault();
            if (!featuresDirty || featuresSaving) return;
            void handleSaveFeatures();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [shortcutActive, featuresDirty, featuresSaving, handleSaveFeatures]);

    return {
        featureValues,
        setFeatureValues,
        featureSearch,
        setFeatureSearch,
        featuresSaving,
        featuresDirty,
        handleSaveFeatures,
        handleCancelFeatures,
        hydrate,
    };
}
