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
 * Ask uses the read-only preference key; every workflow and execution mode uses
 * the task preference key.
 */

import { getCocClientFor } from '../api/cocClient';
import { useRepoPreferences } from './preferences/useRepoPreferences';
import { getActiveProvider } from '../utils/config';
import type { ChatMode } from '../repos/modeConfig';

export type ChatModeForModel = ChatMode;

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
    /**
     * Optional owning-clone remote baseUrl. When present, the per-repo default
     * model preference is read from that clone's server (AC-07: remote model
     * resolution never falls through to the local client); omitted = local origin.
     */
    baseUrl?: string,
): UseDefaultModelForModeResult {
    const prefs = useRepoPreferences(workspaceId, baseUrl ? getCocClientFor(baseUrl) : undefined);
    const provider = providerOverride ?? getActiveProvider();
    const byProvider = prefs?.defaultModelsByProvider;
    const providerPrefs = typeof byProvider === 'object' && byProvider !== null
        ? (byProvider as Record<string, unknown>)[provider]
        : undefined;
    const nonemptyString = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;

    const prefKey = toPreferenceMode(chatMode);
    const isCopilot = provider === 'copilot';

    // Resolution order:
    // 1. Provider-scoped per-mode default
    // 2. Legacy per-mode default (Copilot migration only)
    // 3. Legacy repo-wide default (Copilot migration only)
    // 4. undefined
    const effectiveModel =
        nonemptyString(typeof providerPrefs === 'object' && providerPrefs !== null
            ? (providerPrefs as Record<string, unknown>)[prefKey] : providerPrefs) ||
        (isCopilot ? nonemptyString(prefs?.defaultModels?.[prefKey]) : undefined) ||
        (isCopilot ? nonemptyString(prefs?.defaultModel) : undefined) ||
        undefined;

    const matched = effectiveModel
        ? availableModels.find(m => m.id === effectiveModel)
        : undefined;
    const effectiveModelName = matched?.name || effectiveModel;

    return { effectiveModel, effectiveModelName };
}
