import { useEffect, useState } from 'react';
import { cloneApiBase } from '../../../repos/cloneRegistry';
import type { ChatProviderId } from '@plusplusoneplusplus/coc-client';

/**
 * Real-time process-scoped warm status for a conversation, pushed from the backend
 * `WarmClientRegistry` over a dedicated warm-only SSE channel (AC-02). It mirrors
 * the server `WarmStatus` union one-to-one:
 *  - `cold`    — not in the registry (or the stream is down / reconnecting);
 *                the indicator renders nothing;
 *  - `warming` — a client is being prewarmed (amber-pulse dot);
 *  - `warm`    — a live client is parked and ready (green dot);
 *  - `active`  — a turn is in flight on a live client (green dot).
 *
 * Providers that never enter the registry (e.g. Claude) emit an explicit `cold`
 * snapshot and no further transitions, so the dot stays invisible — no
 * special-casing needed on the SPA side.
 */
export type WarmClientStatus = 'cold' | 'warming' | 'warm' | 'active';

/** Runtime guard for the four valid statuses pushed over SSE. */
const WARM_STATUSES: readonly WarmClientStatus[] = ['cold', 'warming', 'warm', 'active'];

export interface UseWarmClientStatusOptions {
    /** Workspace the conversation belongs to — drives remote-clone routing. */
    workspaceId: string | null | undefined;
    /** Conversation/process id whose warm state should be reflected. */
    processId: string | null | undefined;
    /** Provider whose `(provider, processId)` warm key should be observed. */
    provider?: ChatProviderId;
    /**
     * When false, the SSE subscription is suppressed and the status stays
     * `cold` (e.g. there is no live conversation to reflect). Default true.
     */
    enabled?: boolean;
}

/**
 * Subscribe to a conversation process's real-time warm status for the tiny warm
 * indicator (AC-02).
 *
 * Opens a dedicated warm-only SSE stream (`/processes/:id/stream?warm=1`) that
 * the backend keeps open across conversation completion. The backend sends an
 * initial `warm_status` snapshot on connect (so an already-warm chat shows the
 * dot immediately) and then streams every subsequent transition, including the
 * `active → warm` change when a follow-up finishes on a completed conversation.
 * Incoming `warm_status` events map directly onto {@link WarmClientStatus}.
 *
 * Truth lives entirely in the stream — there is no client-side debounce, POST,
 * or decay timer. Typing-driven prewarming is a separate side-effect hook
 * (`useTypingPrewarmClient`); this hook only observes. The status resets to
 * `cold` on a processId/workspace/provider change, on unmount, and whenever the stream
 * drops; the next push (an initial snapshot or a transition) restores it.
 */
export function useWarmClientStatus({
    workspaceId,
    processId,
    provider,
    enabled = true,
}: UseWarmClientStatusOptions): WarmClientStatus {
    const [status, setStatus] = useState<WarmClientStatus>('cold');

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

        // A fresh subscription starts cold; the backend pushes the current
        // snapshot right away, so the dot settles to the real state quickly.
        setStatus('cold');

        const providerQuery = provider ? `&provider=${encodeURIComponent(provider)}` : '';
        const es = new EventSource(
            `${cloneApiBase(workspaceId)}/processes/${encodeURIComponent(processId)}/stream?warm=1${providerQuery}`,
        );

        es.addEventListener('warm_status', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if (WARM_STATUSES.includes(data?.status)) {
                    setStatus(data.status as WarmClientStatus);
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
    }, [workspaceId, processId, provider, enabled]);

    return status;
}
