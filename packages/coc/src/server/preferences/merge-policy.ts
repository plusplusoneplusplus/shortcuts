import type { GlobalPreferences, PerRepoPreferences } from './schema';
import { validateGlobalPreferences, validatePerRepoPreferences } from './schema';

export interface PreferencesPatchResult<TPreferences> {
    preferences: TPreferences;
    patch: TPreferences;
}

export function applyGlobalPreferencesPatch(
    existing: GlobalPreferences | undefined,
    rawPatch: unknown,
): PreferencesPatchResult<GlobalPreferences> {
    const current = existing ?? {};
    const patch = validateGlobalPreferences(rawPatch);
    const merged: GlobalPreferences = { ...current, ...patch };

    // Deep-merge activityFilters so patching { activityFilters: { workspace: 'x' } }
    // preserves existing My Work exclusions.
    if (patch.activityFilters && current.activityFilters) {
        merged.activityFilters = { ...current.activityFilters, ...patch.activityFilters };
    }
    if (patch.promptAutocomplete && current.promptAutocomplete) {
        merged.promptAutocomplete = {
            ...current.promptAutocomplete,
            ...patch.promptAutocomplete,
            ai: patch.promptAutocomplete.ai || current.promptAutocomplete.ai
                ? { ...(current.promptAutocomplete.ai ?? {}), ...(patch.promptAutocomplete.ai ?? {}) }
                : undefined,
        };
    }

    return { preferences: merged, patch };
}

export function applyRepoPreferencesPatch(
    existing: PerRepoPreferences | undefined,
    rawPatch: unknown,
): PreferencesPatchResult<PerRepoPreferences> {
    const current = existing ?? {};
    const patch = validatePerRepoPreferences(rawPatch);
    const raw = isRecord(rawPatch) ? rawPatch : {};
    const merged: PerRepoPreferences = { ...current, ...patch };

    // Deep-merge lastSkills so that patching { lastSkills: { ask: 'x' } }
    // preserves existing active mode values.
    if (patch.lastSkills && current.lastSkills) {
        merged.lastSkills = { ...current.lastSkills, ...patch.lastSkills };
    }

    // Remove modes explicitly cleared by the client (empty array = "user cleared").
    if (merged.lastSkills) {
        for (const mode of ['task', 'ask'] as const) {
            if (Array.isArray(merged.lastSkills[mode]) && merged.lastSkills[mode]!.length === 0) {
                delete merged.lastSkills[mode];
            }
        }
        if (Object.keys(merged.lastSkills).length === 0) {
            delete merged.lastSkills;
        }
    }

    // Deep-merge lastModels so that patching { lastModels: { ask: 'x' } }
    // preserves existing active mode values.
    if (patch.lastModels && current.lastModels) {
        merged.lastModels = { ...current.lastModels, ...patch.lastModels };
    }

    // Deep-merge defaultModels so that patching { defaultModels: { task: 'x' } }
    // preserves existing per-mode overrides.
    if (patch.defaultModels && current.defaultModels) {
        merged.defaultModels = { ...current.defaultModels, ...patch.defaultModels };
    }
    // Remove per-mode entries explicitly cleared by the client (empty string = clear).
    if (merged.defaultModels) {
        for (const mode of ['task', 'ask', 'note', 'schedule', 'followUp', 'memory'] as const) {
            if (merged.defaultModels[mode] === '') {
                delete merged.defaultModels[mode];
            }
        }
        if (Object.keys(merged.defaultModels).length === 0) {
            delete merged.defaultModels;
        }
    }
    // Clear defaultModel when explicitly set to empty string.
    if (raw.defaultModel === '') {
        delete merged.defaultModel;
    }

    // Deep-merge activityFilters so that patching { activityFilters: { statusFilter: 'x' } }
    // preserves existing typeFilter value.
    if (patch.activityFilters && current.activityFilters) {
        merged.activityFilters = { ...current.activityFilters, ...patch.activityFilters };
    }

    // Deep-merge work-item preferences so updating polling cadence does
    // not clear the workspace GitHub owner/repo override.
    if (patch.workItems && current.workItems) {
        merged.workItems = {
            ...current.workItems,
            ...patch.workItems,
            sync: patch.workItems.sync || current.workItems.sync
                ? {
                    ...(current.workItems.sync ?? {}),
                    ...(patch.workItems.sync ?? {}),
                    github: patch.workItems.sync?.github || current.workItems.sync?.github
                        ? {
                            ...(current.workItems.sync?.github ?? {}),
                            ...(patch.workItems.sync?.github ?? {}),
                        }
                        : undefined,
                    azureBoards: patch.workItems.sync?.azureBoards || current.workItems.sync?.azureBoards
                        ? {
                            ...(current.workItems.sync?.azureBoards ?? {}),
                            ...(patch.workItems.sync?.azureBoards ?? {}),
                        }
                        : undefined,
                }
                : undefined,
        };
    }

    // Explicitly set linkedRepoIds to empty array when client sends [] to clear.
    if (Array.isArray(raw.linkedRepoIds) && raw.linkedRepoIds.length === 0) {
        delete merged.linkedRepoIds;
    }

    return { preferences: merged, patch };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
