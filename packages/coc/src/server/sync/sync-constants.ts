/**
 * Side-effect-free sync constants.
 *
 * Kept separate from `sync-engine.ts` (which pulls in `fs` and the native git
 * addon at module load) so lightweight consumers — e.g.
 * `preferences/live-effects.ts` and the server bootstrap — can read the default
 * interval without dragging the whole engine into their import graph.
 */

/**
 * Default interval between periodic syncs, in minutes. Shared by every call
 * site that starts an engine without an explicit `intervalMinutes` preference.
 */
export const DEFAULT_SYNC_INTERVAL_MINUTES = 30;

/** Upper bound (minutes) for the failure backoff delay. */
export const MAX_SYNC_BACKOFF_MINUTES = 30;
