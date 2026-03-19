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
import { getApiBase, getWsPath } from '../utils/config';

export function useFileCommentCounts(
    wsId: string,
    oldRef: string | null,
    newRef: string | null,
): Map<string, number> {
    const [counts, setCounts] = useState<Map<string, number>>(new Map());

    const fetchCounts = useCallback(() => {
        if (!wsId || !oldRef || !newRef) {
            setCounts(new Map());
            return;
        }
        const params = new URLSearchParams({ oldRef, newRef, status: 'open' });
        fetch(`${getApiBase()}/diff-comment-counts/${encodeURIComponent(wsId)}?${params}`)
            .then(res => (res.ok ? res.json() : Promise.reject(new Error('fetch failed'))))
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
    }, [wsId, oldRef, newRef]);

    useEffect(() => {
        fetchCounts();
    }, [fetchCounts]);

    // WebSocket subscription for instant refresh on diff-comment-updated
    useEffect(() => {
        if (!wsId) return;
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${protocol}://${window.location.host}${getWsPath()}`);
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
