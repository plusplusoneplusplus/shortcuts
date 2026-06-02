/**
 * useRalphSessionView — fetch the per-session journal (`session.json`,
 * parsed `progress.md` sections, and raw session files) for a Ralph session,
 * and refresh it on:
 *
 *   - the `ralph-session-complete` window CustomEvent (re-broadcast from
 *     the WebSocket layer in `App.tsx`)
 *   - a lightweight 5-second poll while the session phase is `executing`
 *     (so iterations stream in without WS coupling)
 *
 * Returns:
 *   - `view = undefined` while the first fetch is in flight
 *   - `view = null` when the server returns 404 (session not found)
 *   - `view = { record, sections, files }` on success
 *
 * The hook is intentionally narrow: it only owns the read-side of the
 * journal. Mutations (start, cancel) are owned by the queue/route layer.
 */

import { useEffect, useRef, useState } from 'react';
import { getSpaCocClient } from '../../api/cocClient';
import type { RalphSessionView } from './RalphWorkflowPane';

const DEFAULT_POLL_MS = 5000;

export function useRalphSessionView(
    workspaceId: string,
    sessionId: string | null | undefined,
    pollMs: number = DEFAULT_POLL_MS,
): { view: RalphSessionView | null | undefined; refresh: () => void } {
    const [view, setView] = useState<RalphSessionView | null | undefined>(undefined);
    // Bumping `tick` triggers a re-fetch via the effect dependency.
    const [tick, setTick] = useState(0);
    const cancelledRef = useRef(false);

    useEffect(() => {
        cancelledRef.current = false;
        if (!sessionId) {
            setView(undefined);
            return;
        }
        // Reset to loading whenever the target session changes.
        setView(undefined);
        return () => {
            cancelledRef.current = true;
        };
    }, [workspaceId, sessionId]);

    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;
        getSpaCocClient()
            .workspaces.ralphSession(workspaceId, sessionId)
            .then((res) => {
                if (cancelled) return;
                setView({ record: res.record, sections: res.sections, files: res.files });
            })
            .catch((err: any) => {
                if (cancelled) return;
                // 404 → empty / not found state. Anything else → also surface
                // as null (the pane shows the same "not found" copy); a
                // future revision can split into an error state if needed.
                if (err && typeof err.status === 'number' && err.status === 404) {
                    setView(null);
                } else {
                    setView(null);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [workspaceId, sessionId, tick]);

    // Refresh on Ralph WS event (broadcast by App.tsx).
    useEffect(() => {
        if (!sessionId) return;
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (!detail?.repoId || detail.repoId === workspaceId) {
                setTick((n) => n + 1);
            }
        };
        window.addEventListener('ralph-session-complete', handler);
        return () => window.removeEventListener('ralph-session-complete', handler);
    }, [workspaceId, sessionId]);

    // Poll while executing. The interval is reset (and skipped) when the
    // session reaches a terminal phase.
    useEffect(() => {
        if (!sessionId) return;
        if (!view || view.record.phase !== 'executing') return;
        const id = setInterval(() => setTick((n) => n + 1), pollMs);
        return () => clearInterval(id);
    }, [sessionId, view, pollMs]);

    return { view, refresh: () => setTick((n) => n + 1) };
}
