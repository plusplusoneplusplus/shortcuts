export interface DefaultSkillFeatureState {
    cronEnabled: boolean;
    canvasEnabled: boolean;
}

/** Remove default skills whose backing server feature is unavailable. */
export function getDefaultSkillsToInstall(
    defaultSkills: readonly string[],
    features: DefaultSkillFeatureState,
): string[] {
    return defaultSkills.filter(name =>
        (name !== 'cron' || features.cronEnabled)
        && (name !== 'canvas' || features.canvasEnabled),
    );
}
