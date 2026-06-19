/**
 * runWithWarmClient — shared warm-client turn lifecycle for SDK providers.
 *
 * Wraps a single turn in the acquire → run → release dance against a
 * {@link WarmClientRegistry}:
 *   1. Acquire a client for the key — reusing a parked/warming one when
 *      available (a warm hit), cold-starting otherwise (a cold miss).
 *   2. Run the turn with that client.
 *   3. Release it — parking the client on clean completion (`keepWarm: true`)
 *      or tearing it down on abort/error (`keepWarm: false`).
 *
 * If acquisition fails (the factory rejects — e.g. the client process won't
 * spawn), the registry rolls its entry back and this helper transparently falls
 * back to {@link WarmRunParams.coldFallback} so the turn still runs cold. This
 * is the path providers that can't stay warm rely on indirectly, and it keeps a
 * flaky warm-start from ever failing a turn outright.
 *
 * Both the Copilot and Codex providers route their warm turns through here, so
 * the warm-lifecycle bookkeeping lives in exactly one place. Each provider
 * supplies its own client factory (how to spawn/start its client) and turn body
 * (how to run a turn on it and whether the outcome is clean).
 */

import type { WarmClientRegistry, WarmClientFactory, WarmClientHandle } from './warm-client-registry';

/** Outcome of a warm turn: the provider result plus whether to keep the client warm. */
export interface WarmRunOutcome<T> {
    /** The value to return to the caller. */
    result: T;
    /**
     * `true` to park the client for reuse (clean completion); `false` to tear it
     * down now (abort/interrupt/error).
     */
    keepWarm: boolean;
}

/** Minimal structured-logger shape (pino-compatible). */
interface WarmRunLogger {
    debug(obj: unknown, msg?: string): void;
}

export interface WarmRunParams<T> {
    /** The registry owning warm clients for this provider. */
    registry: WarmClientRegistry;
    /** Registry key for this turn — typically `makeWarmKey(provider, workingDirectory)`. */
    key: string;
    /** Creates and starts a warm client handle on a cold miss. */
    factory: WarmClientFactory;
    /** Runs the turn with the acquired client, reporting whether to keep it warm. */
    run: (handle: WarmClientHandle, warmHit: boolean) => Promise<WarmRunOutcome<T>>;
    /** Runs the turn cold when warm acquisition fails (no registry entry left behind). */
    coldFallback: () => Promise<T>;
    /** Optional structured logger for diagnostics. */
    logger?: WarmRunLogger;
}

/**
 * Run a turn against a warm client, parking it on clean completion and tearing
 * it down on abort/error. See the module docstring for the full contract.
 */
export async function runWithWarmClient<T>(params: WarmRunParams<T>): Promise<T> {
    const { registry, key, factory, run, coldFallback, logger } = params;

    let acquired;
    try {
        acquired = await registry.acquire(key, factory);
    } catch (err) {
        // Warm cold-start failed; the registry already rolled its entry back, so
        // there is no leak. Run the turn cold so the user still gets a response.
        logger?.debug(
            { key, err: err instanceof Error ? err.message : String(err) },
            'Warm client unavailable; falling back to cold start',
        );
        return coldFallback();
    }

    let keepWarm = false;
    try {
        const outcome = await run(acquired.handle, acquired.warmHit);
        keepWarm = outcome.keepWarm;
        return outcome.result;
    } finally {
        // Park on clean completion; tear down on abort/error (keepWarm stays false
        // if `run` threw before reporting an outcome).
        await registry.release(key, { keep: keepWarm });
    }
}
