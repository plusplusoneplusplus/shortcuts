/**
 * useDefaultModelForMode — resolves the effective default model for a given chat mode
 * from per-repo preferences.
 *
 * Resolution order (mirrors server-side resolveDefaultModel):
 * 1. Per-mode default from `defaultModels[mode]`
 * 2. Repo-wide default from `defaultModel`
 * 3. undefined (CLI default)
 *
 * The `chatMode` parameter uses the UI chat modes ('ask' | 'plan' | 'autopilot' | 'ralph').
 * 'autopilot' and 'ralph' map to the 'task' preference key.
 */

import { useState, useEffect } from 'react';
import { getSpaCocClient } from '../api/cocClient';

export type ChatModeForModel = 'ask' | 'plan' | 'autopilot' | 'ralph';

/** Map UI chat mode to the preference key used by the server. */
function toPreferenceMode(chatMode: ChatModeForModel): string {
    return chatMode === 'autopilot' || chatMode === 'ralph' ? 'task' : chatMode;
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
): UseDefaultModelForModeResult {
    const [defaultModel, setDefaultModel] = useState<string | undefined>();
    const [defaultModels, setDefaultModels] = useState<Record<string, string | undefined>>({});

    useEffect(() => {
        setDefaultModel(undefined);
        setDefaultModels({});
        if (!workspaceId) return;
        let cancelled = false;
        getSpaCocClient().preferences.getRepo(workspaceId)
            .then((prefs: any) => {
                if (cancelled) return;
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
    }, [workspaceId]);

    const prefKey = toPreferenceMode(chatMode);
    const effectiveModel = defaultModels[prefKey] || defaultModel || undefined;

    const matched = effectiveModel
        ? availableModels.find(m => m.id === effectiveModel)
        : undefined;
    const effectiveModelName = matched?.name || effectiveModel;

    return { effectiveModel, effectiveModelName };
}
