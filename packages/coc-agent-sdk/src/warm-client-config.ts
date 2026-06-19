/**
 * Warm-client keep-alive configuration, resolved from the environment.
 *
 * The idle TTL controls how long a provider client process is kept alive after
 * a turn completes cleanly before it is torn down (see {@link WarmClientRegistry}).
 * A value of `0` (or negative) disables warming entirely: clients are torn down
 * immediately on release and {@link WarmClientRegistry.prewarm} no-ops.
 */

/** Default idle TTL when the environment override is absent or invalid (5 minutes). */
export const DEFAULT_WARM_CLIENT_TTL_MS = 300_000;

/** Environment variable that overrides the warm-client idle TTL (in milliseconds). */
export const WARM_CLIENT_TTL_ENV = 'COC_WARM_CLIENT_TTL_MS';

/**
 * Resolve the warm-client idle TTL (ms) from the environment.
 *
 * Falls back to {@link DEFAULT_WARM_CLIENT_TTL_MS} when the override is absent,
 * blank, non-numeric, or negative. A value of `0` is honored and disables
 * warming. Fractional values are floored.
 *
 * @param env - Environment map to read from (defaults to `process.env`).
 */
export function resolveWarmClientTtlMs(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env[WARM_CLIENT_TTL_ENV];
    if (raw === undefined) return DEFAULT_WARM_CLIENT_TTL_MS;
    const trimmed = raw.trim();
    if (trimmed === '') return DEFAULT_WARM_CLIENT_TTL_MS;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_WARM_CLIENT_TTL_MS;
    return Math.floor(parsed);
}

/**
 * Default debounce (ms) for the typing-driven client prewarm. Kept low enough
 * that the warm client is usually ready by the time a short follow-up is sent,
 * but high enough that we don't fire on every keystroke.
 */
export const DEFAULT_WARM_PREWARM_DEBOUNCE_MS = 500;

/** Environment variable that overrides the prewarm debounce (in milliseconds). */
export const WARM_PREWARM_DEBOUNCE_ENV = 'COC_WARM_PREWARM_DEBOUNCE_MS';

/**
 * Resolve the typing-driven prewarm debounce (ms) from the environment.
 *
 * The server resolves this once and surfaces it to the SPA via the runtime
 * feature-flag channel, so the `usePrewarmClient` hook waits the configured
 * window before firing a prewarm. Falls back to
 * {@link DEFAULT_WARM_PREWARM_DEBOUNCE_MS} when the override is absent, blank,
 * non-numeric, or negative. A value of `0` fires the prewarm without debouncing.
 * Fractional values are floored.
 *
 * @param env - Environment map to read from (defaults to `process.env`).
 */
export function resolveWarmPrewarmDebounceMs(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env[WARM_PREWARM_DEBOUNCE_ENV];
    if (raw === undefined) return DEFAULT_WARM_PREWARM_DEBOUNCE_MS;
    const trimmed = raw.trim();
    if (trimmed === '') return DEFAULT_WARM_PREWARM_DEBOUNCE_MS;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_WARM_PREWARM_DEBOUNCE_MS;
    return Math.floor(parsed);
}
