/**
 * useCommitCommentTotals — fetch total active comment counts per commit hash.
 *
 * Calls GET /api/diff-comment-totals/:wsId?commits=hash1,hash2,...&status=open
 * and returns a Map<commitHash, number>.  Returns an empty Map while loading or
 * on error — comment counts are non-critical and should never break the UI.
 *
 * Automatically refreshes when wsId or the set of commit hashes changes.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase, getWsUrl } from '../utils/config';

export function useCommitCommentTotals(
    wsId: string,
    commitHashes: string[],
): Map<string, number> {
    const [totals, setTotals] = useState<Map<string, number>>(new Map());

    // Stable key for the hash list so the effect only re-runs when the
    // set of commits actually changes.
    const commitsKey = commitHashes.join(',');

    const fetchTotals = useCallback(() => {
        if (!wsId || !commitsKey) {
            setTotals(new Map());
            return;
        }
        const params = new URLSearchParams({ commits: commitsKey, status: 'open' });
        fetch(`${getApiBase()}/diff-comment-totals/${encodeURIComponent(wsId)}?${params}`)
            .then(res => (res.ok ? res.json() : Promise.reject(new Error('fetch failed'))))
            .then((data: { totals: Record<string, number> }) => {
                const map = new Map<string, number>();
                for (const [k, v] of Object.entries(data.totals)) {
                    if (v > 0) map.set(k, v);
                }
                setTotals(map);
            })
            .catch(() => {
                // Fail silently — comment totals are non-critical
            });
    }, [wsId, commitsKey]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (commitHashes.length === 0) {
            setTotals(new Map());
            return;
        }
        fetchTotals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchTotals]);

    // WebSocket subscription for instant refresh on diff-comment-updated
    useEffect(() => {
        if (!wsId) return;
        const ws = new WebSocket(getWsUrl());
        ws.addEventListener('message', (event) => {
            try {
                const msg = JSON.parse(event.data as string) as { type: string; workspaceId?: string };
                if (msg.type === 'diff-comment-updated' && msg.workspaceId === wsId) {
                    fetchTotals();
                }
            } catch { /* ignore parse errors */ }
        });
        return () => { ws.close(); };
    }, [wsId, fetchTotals]);

    return totals;
}
