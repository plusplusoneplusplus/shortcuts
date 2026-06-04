/**
 * useDefaultModelForMode — resolves the effective default model for a given chat mode
 * from per-repo preferences, with provider-scoped resolution.
 *
 * Resolution order (provider-aware):
 * 1. `defaultModelsByProvider[provider][mode]`
 * 2. `defaultModelsByProvider[provider]` (all-mode fallback, if stored as string)
 * 3. Legacy `defaultModels[mode]` only as Copilot migration fallback
 * 4. Legacy `defaultModel` only as Copilot migration fallback
 * 5. undefined (CLI default)
 *
 * The `chatMode` parameter uses the UI chat modes ('ask' | 'autopilot' | 'ralph' | 'for-each').
 * 'autopilot', 'ralph', and 'for-each' map to the 'task' preference key.
 */

import { useState, useEffect } from 'react';
import { getSpaCocClient } from '../api/cocClient';
import { getActiveProvider } from '../utils/config';

export type ChatModeForModel = 'ask' | 'autopilot' | 'ralph' | 'for-each';

/** Map UI chat mode to the preference key used by the server. */
function toPreferenceMode(chatMode: ChatModeForModel): string {
    return chatMode === 'ask' ? 'ask' : 'task';
}

export interface UseDefaultModelForModeResult {
    /** The resolved default model ID, or undefined if no preference is set. */
    effectiveModel: string | undefined;
    /** Human-readable display name for the model, falling back to the model ID. */
    effectiveModelName: string | undefined;
}

export function useDefaultModelForMode(
    workspaceId: string | undefined,
    chatMode: ChatModeForModel,
    /** Available models used to resolve display names. */
    availableModels: { id: string; name?: string }[],
    /** Provider whose defaults should be resolved. Defaults to active dashboard provider. */
    providerOverride?: string,
): UseDefaultModelForModeResult {
    const [defaultModel, setDefaultModel] = useState<string | undefined>();
    const [defaultModels, setDefaultModels] = useState<Record<string, string | undefined>>({});
    const [providerModels, setProviderModels] = useState<Record<string, string | undefined>>({});
    const provider = providerOverride ?? getActiveProvider();

    useEffect(() => {
        setDefaultModel(undefined);
        setDefaultModels({});
        setProviderModels({});
        if (!workspaceId) return;
        let cancelled = false;
        getSpaCocClient().preferences.getRepo(workspaceId)
            .then((prefs: any) => {
                if (cancelled) return;

                // Provider-scoped defaults: defaultModelsByProvider.<provider>.<mode>
                const byProvider = prefs.defaultModelsByProvider;
                if (typeof byProvider === 'object' && byProvider !== null) {
                    const providerPrefs = byProvider[provider];
                    if (typeof providerPrefs === 'object' && providerPrefs !== null) {
                        const cleaned: Record<string, string> = {};
                        for (const [k, v] of Object.entries(providerPrefs)) {
                            if (typeof v === 'string' && v) cleaned[k] = v;
                        }
                        setProviderModels(cleaned);
                    } else if (typeof providerPrefs === 'string' && providerPrefs) {
                        setProviderModels({ '*': providerPrefs });
                    }
                }

                // Legacy fields (used as Copilot migration fallback)
                if (typeof prefs.defaultModel === 'string' && prefs.defaultModel) {
                    setDefaultModel(prefs.defaultModel);
                }
                if (typeof prefs.defaultModels === 'object' && prefs.defaultModels !== null) {
                    const cleaned: Record<string, string> = {};
                    for (const [k, v] of Object.entries(prefs.defaultModels)) {
                        if (typeof v === 'string' && v) cleaned[k] = v;
                    }
                    setDefaultModels(cleaned);
                }
            })
            .catch(() => { /* preferences are optional */ });
        return () => { cancelled = true; };
    }, [workspaceId, provider]);

    const prefKey = toPreferenceMode(chatMode);
    const isCopilot = provider === 'copilot';

    // Resolution order:
    // 1. Provider-scoped per-mode default
    // 2. Legacy per-mode default (Copilot migration only)
    // 3. Legacy repo-wide default (Copilot migration only)
    // 4. undefined
    const effectiveModel =
        providerModels[prefKey] ||
        providerModels['*'] ||
        (isCopilot ? defaultModels[prefKey] : undefined) ||
        (isCopilot ? defaultModel : undefined) ||
        undefined;

    const matched = effectiveModel
        ? availableModels.find(m => m.id === effectiveModel)
        : undefined;
    const effectiveModelName = matched?.name || effectiveModel;

    return { effectiveModel, effectiveModelName };
}
