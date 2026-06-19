import { useEffect, useRef, useState } from 'react';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';

/**
 * Default debounce (ms) for the typing-driven client prewarm. Kept low enough
 * that the warm client is usually ready by the time a short follow-up is sent,
 * but high enough that we don't fire on every keystroke. The call site overrides
 * this from runtime config (env COC_WARM_PREWARM_DEBOUNCE_MS) via the
 * `debounceMs` option; this constant is the fallback when config is absent.
 */
export const PREWARM_DEBOUNCE_MS = 500;

/**
 * Optimistic, client-only warm status surfaced by {@link usePrewarmClient} for
 * the tiny "session warm" indicator (AC-02). It is best-effort: derived solely
 * from the prewarm response plus a client-side TTL timer, so it can briefly
 * disagree with the server after a restart or error-teardown.
 *  - `idle`        — not warmed (or decayed / disabled / errored);
 *  - `warming`     — a prewarm POST is in flight;
 *  - `warm`        — the client reported warm; decays back to `idle` after TTL;
 *  - `unsupported` — the provider cannot stay warm (e.g. Claude); sticky for the
 *                    session so the indicator makes no false promise.
 */
export type PrewarmStatus = 'idle' | 'warming' | 'warm' | 'unsupported';

export interface UsePrewarmClientOptions {
    /** Current composer text. The first non-empty value arms the prewarm. */
    input: string;
    /** Workspace the conversation belongs to — drives remote-clone routing. */
    workspaceId: string | null | undefined;
    /** Conversation/process id whose provider client should be warmed. */
    processId: string | null | undefined;
    /**
     * When false, prewarm is suppressed (e.g. the session is expired or a turn
     * is already generating, which the server would no-op anyway). Default true.
     */
    enabled?: boolean;
    /** Debounce window in ms. Defaults to {@link PREWARM_DEBOUNCE_MS}. */
    debounceMs?: number;
    /**
     * Warm-client idle TTL (ms) — drives the client-side decay timer that drops
     * a `warm` status back to `idle`. Surfaced from server env via
     * `getWarmClientTtlMs()`. `0` is the kill-switch: warming is disabled, so the
     * status never leaves `idle` (the prewarm POST still fires and no-ops
     * server-side, preserving existing behavior). Defaults to `0`.
     */
    ttlMs?: number;
}

/**
 * Prewarm the provider client for a conversation's next turn while the user is
 * typing a follow-up, so the next send reuses a live process instead of paying
 * the full cold-start cost.
 *
 * Behaviour (AC-05):
 *  - fires on the first non-empty composer value, debounced (~500ms);
 *  - routes through `getCocClientForWorkspace` so remote clones hit the right
 *    coc server;
 *  - fires at most once per "warm window" — latched until the composer empties
 *    (after a send or a manual clear), then re-arms for the next follow-up;
 *  - the pending call is cancelled on further typing (debounce), on send (the
 *    composer clears), and on unmount;
 *  - best-effort: failures are swallowed.
 *
 * Status (AC-02): returns an optimistic {@link PrewarmStatus} for the tiny warm
 * indicator. Transitions are driven only by data the hook already has — the
 * debounced fire, the prewarm response, the TTL decay timer, and the
 * composer-empty latch reset. When `ttlMs === 0` (warming disabled) the status
 * stays `idle` regardless of the prewarm response (AC-04 kill-switch).
 */
export function usePrewarmClient({
    input,
    workspaceId,
    processId,
    enabled = true,
    debounceMs = PREWARM_DEBOUNCE_MS,
    ttlMs = 0,
}: UsePrewarmClientOptions): PrewarmStatus {
    const [status, setStatus] = useState<PrewarmStatus>('idle');

    // Latch so we issue at most one prewarm per typing session. Reset when the
    // composer empties (post-send / cleared) so the next follow-up warms again.
    const prewarmedRef = useRef(false);
    // Once a provider reports it cannot stay warm (e.g. Claude), it stays
    // `unsupported` for the session — no later prewarm fire may flip it back to
    // `warming`/`warm`, so the indicator never makes a false promise.
    const unsupportedRef = useRef(false);
    // Pending decay timer that drops a `warm` status back to `idle` after TTL.
    const decayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Guards async prewarm resolution from updating state after unmount.
    const mountedRef = useRef(true);

    const clearDecayTimer = () => {
        if (decayTimerRef.current !== null) {
            clearTimeout(decayTimerRef.current);
            decayTimerRef.current = null;
        }
    };

    // Clear timers on unmount; mark unmounted so a late prewarm resolution
    // does not setState on a torn-down component.
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            clearDecayTimer();
        };
    }, []);

    useEffect(() => {
        const hasText = input.trim().length > 0;
        if (!hasText) {
            // Empty composer → reset the once-per-window latch for the next turn,
            // cancel any decay timer, and drop the status back to idle. An
            // `unsupported` verdict is sticky and survives the reset.
            prewarmedRef.current = false;
            clearDecayTimer();
            if (!unsupportedRef.current) setStatus('idle');
            return;
        }
        if (!enabled || !workspaceId || !processId) return;
        if (prewarmedRef.current) return;

        const ws = workspaceId;
        const pid = processId;
        const timer = setTimeout(() => {
            prewarmedRef.current = true;
            // Warming is disabled (kill-switch) or the provider is known
            // unsupported → keep the POST firing (existing behavior) but leave
            // the status untouched.
            const trackStatus = ttlMs > 0 && !unsupportedRef.current;
            if (trackStatus) setStatus('warming');
            void getCocClientForWorkspace(ws)
                .processes.prewarm(pid, { workspace: ws })
                .then((res) => {
                    if (!mountedRef.current || !trackStatus) return;
                    if (res?.warming) {
                        setStatus('warm');
                        // (Re)start the decay timer: warmth lapses after the TTL.
                        clearDecayTimer();
                        decayTimerRef.current = setTimeout(() => {
                            decayTimerRef.current = null;
                            if (mountedRef.current) setStatus('idle');
                        }, ttlMs);
                    } else if (res?.reason === 'unsupported') {
                        unsupportedRef.current = true;
                        clearDecayTimer();
                        setStatus('unsupported');
                    } else {
                        // `error` or an unknown no-op → optimistic warmth fails.
                        setStatus('idle');
                    }
                })
                .catch(() => {
                    // Best-effort; prewarm failures are non-fatal.
                    if (mountedRef.current && trackStatus) setStatus('idle');
                });
        }, debounceMs);

        // Cancel a pending prewarm on re-render (further typing → debounce),
        // on send (the composer clears → next render hits the empty branch),
        // and on unmount.
        return () => clearTimeout(timer);
    }, [input, enabled, workspaceId, processId, debounceMs, ttlMs]);

    return status;
}
