import { useEffect, useRef } from 'react';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';

/**
 * Default debounce (ms) for the typing-driven client prewarm. Kept low enough
 * that the warm client is usually ready by the time a short follow-up is sent,
 * but high enough that we don't fire on every keystroke. The call site overrides
 * this from runtime config (env COC_WARM_PREWARM_DEBOUNCE_MS) via the
 * `debounceMs` option; this constant is the fallback when config is absent.
 */
export const PREWARM_DEBOUNCE_MS = 500;

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
 *  - best-effort: failures are swallowed and there is no UI indicator.
 */
export function usePrewarmClient({
    input,
    workspaceId,
    processId,
    enabled = true,
    debounceMs = PREWARM_DEBOUNCE_MS,
}: UsePrewarmClientOptions): void {
    // Latch so we issue at most one prewarm per typing session. Reset when the
    // composer empties (post-send / cleared) so the next follow-up warms again.
    const prewarmedRef = useRef(false);

    useEffect(() => {
        const hasText = input.trim().length > 0;
        if (!hasText) {
            // Empty composer → reset the once-per-window latch for the next turn.
            prewarmedRef.current = false;
            return;
        }
        if (!enabled || !workspaceId || !processId) return;
        if (prewarmedRef.current) return;

        const ws = workspaceId;
        const pid = processId;
        const timer = setTimeout(() => {
            prewarmedRef.current = true;
            void getCocClientForWorkspace(ws)
                .processes.prewarm(pid, { workspace: ws })
                .catch(() => { /* best-effort; prewarm failures are non-fatal */ });
        }, debounceMs);

        // Cancel a pending prewarm on re-render (further typing → debounce),
        // on send (the composer clears → next render hits the empty branch),
        // and on unmount.
        return () => clearTimeout(timer);
    }, [input, enabled, workspaceId, processId, debounceMs]);
}
