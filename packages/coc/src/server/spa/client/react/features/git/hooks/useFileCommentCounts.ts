/**
 * useFileCommentCounts — fetch active (open) comment counts per storage key.
 *
 * Calls GET /api/diff-comment-counts/:wsId?oldRef=&newRef=&status=open and
 * returns a Map<storageKey, number>.  Returns an empty Map while loading or
 * on error — comment counts are non-critical and should never break the UI.
 *
 * Automatically refreshes when wsId, oldRef, or newRef change.
 */

import { useState, useEffect, useCallback } from 'react';
import { getWsPath } from '../../../utils/config';
import { cloneWsUrl } from '../../../api/wsUrl';
import { useCocClient } from '../../../repos/cloneRouting';

export function useFileCommentCounts(
    wsId: string,
    oldRef: string | null,
    newRef: string | null,
): Map<string, number> {
    const [counts, setCounts] = useState<Map<string, number>>(new Map());
    // Route the count fetch to the workspace's clone server (AC-07); the WS
    // subscription below stays on cloneWsUrl(getWsPath()) unchanged (AC-03).
    const cloneClient = useCocClient(wsId);

    const fetchCounts = useCallback(() => {
        if (!wsId || !oldRef || !newRef) {
            setCounts(new Map());
            return;
        }
        cloneClient.git.getDiffCommentCounts(wsId, { oldRef, newRef, status: 'open' })
            .then((data: { counts: Record<string, number> }) => {
                const map = new Map<string, number>();
                for (const [k, v] of Object.entries(data.counts)) {
                    if (v > 0) map.set(k, v);
                }
                setCounts(map);
            })
            .catch(() => {
                // Fail silently — comment counts are non-critical
            });
    }, [wsId, oldRef, newRef, cloneClient]);

    useEffect(() => {
        fetchCounts();
    }, [fetchCounts]);

    // WebSocket subscription for instant refresh on diff-comment-updated
    useEffect(() => {
        if (!wsId) return;
        const ws = new WebSocket(cloneWsUrl(getWsPath()));
        ws.addEventListener('message', (event) => {
            try {
                const msg = JSON.parse(event.data as string) as { type: string; workspaceId?: string };
                if (msg.type === 'diff-comment-updated' && msg.workspaceId === wsId) {
                    fetchCounts();
                }
            } catch { /* ignore parse errors */ }
        });
        return () => { ws.close(); };
    }, [wsId, fetchCounts]);

    return counts;
}
