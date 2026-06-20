import { useEffect, useState } from 'react';
import { cloneApiBase } from '../../../repos/cloneRegistry';

/**
 * Real-time warm status for a conversation, pushed from the backend
 * `WarmClientRegistry` over the existing SSE channel (AC-02). It mirrors the
 * server `WarmStatus` union one-to-one:
 *  - `cold`    — not in the registry (or the stream is down / reconnecting);
 *                the indicator renders nothing;
 *  - `warming` — a client is being prewarmed (amber-pulse dot);
 *  - `warm`    — a live client is parked and ready (green dot);
 *  - `active`  — a turn is in flight on a live client (green dot).
 *
 * Providers that never enter the registry (e.g. Claude) never emit a
 * `warm_status` event, so the status stays `cold` and the dot stays invisible —
 * no special-casing needed on the SPA side.
 */
export type PrewarmStatus = 'cold' | 'warming' | 'warm' | 'active';

/** Runtime guard for the four valid statuses pushed over SSE. */
const WARM_STATUSES: readonly PrewarmStatus[] = ['cold', 'warming', 'warm', 'active'];

export interface UsePrewarmClientOptions {
    /** Workspace the conversation belongs to — drives remote-clone routing. */
    workspaceId: string | null | undefined;
    /** Conversation/process id whose warm state should be reflected. */
    processId: string | null | undefined;
    /**
     * When false, the SSE subscription is suppressed and the status stays
     * `cold` (e.g. there is no live conversation to reflect). Default true.
     */
    enabled?: boolean;
}

/**
 * Subscribe to a conversation's real-time warm status for the tiny "session
 * warm" indicator (AC-02).
 *
 * Opens a dedicated warm-only SSE stream (`/processes/:id/stream?warm=1`) that
 * the backend keeps open across conversation completion, so the indicator can
 * still reflect the `active → warm` transition when a follow-up finishes on a
 * previously-completed conversation. Incoming `warm_status` events map directly
 * onto {@link PrewarmStatus}.
 *
 * Truth lives entirely in the stream — there is no client-side debounce, POST,
 * or decay timer (AC-03). The status resets to `cold` on a processId/workspace
 * change, on unmount, and whenever the stream drops; the next push restores it.
 */
export function usePrewarmClient({
    workspaceId,
    processId,
    enabled = true,
}: UsePrewarmClientOptions): PrewarmStatus {
    const [status, setStatus] = useState<PrewarmStatus>('cold');

    useEffect(() => {
        // No conversation to reflect (or disabled) → stay invisible.
        if (!enabled || !workspaceId || !processId) {
            setStatus('cold');
            return;
        }
        // SSR / non-browser environments (and jsdom) have no EventSource — there
        // is nothing to subscribe to, so leave the status cold.
        if (typeof EventSource === 'undefined') {
            setStatus('cold');
            return;
        }

        // A fresh subscription starts cold; the backend pushes no initial
        // snapshot, so we wait for the first real transition.
        setStatus('cold');

        const es = new EventSource(
            `${cloneApiBase(workspaceId)}/processes/${encodeURIComponent(processId)}/stream?warm=1`,
        );

        es.addEventListener('warm_status', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if (WARM_STATUSES.includes(data?.status)) {
                    setStatus(data.status as PrewarmStatus);
                }
            } catch {
                /* ignore malformed frames */
            }
        });

        // A dropped / reconnecting stream drops the indicator back to cold until
        // the next push (the EventSource auto-reconnects on its own).
        es.addEventListener('error', () => {
            setStatus('cold');
        });

        return () => {
            es.close();
        };
    }, [workspaceId, processId, enabled]);

    return status;
}
