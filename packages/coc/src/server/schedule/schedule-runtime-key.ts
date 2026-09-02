/**
 * Schedule IDs are only unique *within* a workspace.  Repo-defined schedules
 * derive their ID from the YAML filename (`repo:<stem>`), so two clones that
 * both ship `.github/schedules/daily.yaml` produce the same `repo:daily` ID.
 *
 * Every piece of schedule *runtime* state — timers, in-flight runs, run
 * history — must therefore be keyed by `(repoId, scheduleId)`, never by the
 * schedule ID alone.  This module is the single encoder for that pair.
 *
 * The key type is opaque (branded) so a bare `scheduleId` string cannot be
 * passed where a runtime key is expected.
 */

/** Separator that cannot appear in a repoId or scheduleId. */
const SEPARATOR = '\0';

declare const scheduleRuntimeKeyBrand: unique symbol;

/** Opaque `(repoId, scheduleId)` pair used to key schedule runtime state. */
export type ScheduleRuntimeKey = string & { readonly [scheduleRuntimeKeyBrand]: true };

/** The workspace-scoped identity of a schedule. */
export interface ScheduleScope {
    repoId: string;
    scheduleId: string;
}

/** Encode a workspace-scoped schedule identity into a stable runtime key. */
export function scheduleRuntimeKey(repoId: string, scheduleId: string): ScheduleRuntimeKey {
    return `${repoId}${SEPARATOR}${scheduleId}` as ScheduleRuntimeKey;
}

/** Decode a runtime key back into its `(repoId, scheduleId)` parts. */
export function parseScheduleRuntimeKey(key: ScheduleRuntimeKey): ScheduleScope {
    const idx = key.indexOf(SEPARATOR);
    if (idx < 0) {
        // Defensive: keys are only ever produced by scheduleRuntimeKey().
        return { repoId: '', scheduleId: key };
    }
    return { repoId: key.slice(0, idx), scheduleId: key.slice(idx + SEPARATOR.length) };
}

/** True when the key belongs to the given schedule ID, in any workspace. */
export function runtimeKeyMatchesSchedule(key: ScheduleRuntimeKey, scheduleId: string): boolean {
    return parseScheduleRuntimeKey(key).scheduleId === scheduleId;
}
