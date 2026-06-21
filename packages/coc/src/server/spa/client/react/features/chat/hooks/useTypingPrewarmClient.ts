import { useEffect, useRef } from 'react';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';

export interface UseTypingPrewarmClientOptions {
    /** Current composer text. A non-empty trimmed value opens a typing window. */
    input: string;
    /** Workspace the conversation belongs to — drives remote-clone routing. */
    workspaceId: string | null | undefined;
    /** Conversation/process id to prewarm. */
    processId: string | null | undefined;
    /**
     * When false, no prewarm is scheduled (e.g. the session is expired, a turn is
     * already in flight, or a send is underway). Default true.
     */
    enabled?: boolean;
    /** Debounce before the prewarm POST fires, in ms. Default 0 (fire next tick). */
    debounceMs?: number;
}

/**
 * Trigger backend client prewarming while the user types a follow-up.
 *
 * This is the side-effect half of the warm-client UX, deliberately split from the
 * stream-observing {@link useWarmClientStatus}: typing drives the server-side
 * warm lifecycle (`POST /processes/:id/prewarm`), and the SSE stream — not this
 * hook — is the single source of truth for the warm dot. The prewarm response is
 * intentionally ignored; only the stream may change the displayed status.
 *
 * Behaviour:
 *  - Empty (`input.trim()` is `''`) clears any pending timer and resets the
 *    "already prewarmed this typing window" latch, so the next non-empty input
 *    can prewarm again.
 *  - Disabled, or a missing `workspaceId`/`processId`, does nothing.
 *  - The first non-empty input in a typing window schedules one debounced
 *    prewarm; it fires at most once per window. Further typing reschedules the
 *    timer until it fires, then stays latched until the composer empties or the
 *    `(workspaceId, processId)` key changes.
 *  - The pending timer is cancelled on input changes, disable, key change, and
 *    unmount.
 *  - Prewarm errors are swallowed — the request is best-effort and must never
 *    block typing or sending.
 */
export function useTypingPrewarmClient({
    input,
    workspaceId,
    processId,
    enabled = true,
    debounceMs = 0,
}: UseTypingPrewarmClientOptions): void {
    // Latch: true once a prewarm has been scheduled for the current typing
    // window. Reset when the composer empties or the conversation key changes.
    const prewarmedRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimer = () => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    // Reset the latch (and drop any pending timer) whenever the conversation
    // identity changes, so prewarming is scoped per (workspace, process).
    useEffect(() => {
        prewarmedRef.current = false;
        clearTimer();
        return clearTimer;
    }, [workspaceId, processId]);

    useEffect(() => {
        const hasText = input.trim().length > 0;

        // Empty composer → close the typing window and re-arm for next time.
        if (!hasText) {
            clearTimer();
            prewarmedRef.current = false;
            return;
        }

        // Nothing to prewarm, or already prewarmed this window.
        if (!enabled || !workspaceId || !processId || prewarmedRef.current) {
            return;
        }

        // Capture the key so a late-firing timer cannot prewarm a stale process.
        const ws = workspaceId;
        const pid = processId;
        clearTimer();
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            prewarmedRef.current = true; // latch: at most one prewarm per window
            try {
                // Route through the workspace-specific client so remote clones hit
                // the correct CoC server. Best-effort: ignore the response and
                // swallow rejections — the stream owns the dot, not this call.
                void getCocClientForWorkspace(ws)
                    .processes.prewarm(pid, { workspace: ws })
                    .catch(() => {});
            } catch {
                /* never let a prewarm failure disrupt typing */
            }
        }, debounceMs);

        return clearTimer;
    }, [input, workspaceId, processId, enabled, debounceMs]);
}
