/**
 * useCommitCommentTotals — fetch comment counts per commit hash.
 *
 * Calls GET /api/diff-comment-totals/:wsId?commits=hash1,hash2,...
 * and returns a Map<commitHash, { open: number; resolved: number }>.
 *
 * Returns an empty Map while loading or on error — comment counts are
 * non-critical and should never break the UI.
 *
 * Automatically refreshes when wsId or the set of commit hashes changes.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase, getWsPath } from '../utils/config';

export interface CommitCommentTotals {
    open: number;
    resolved: number;
}

export function useCommitCommentTotals(
    wsId: string,
    commitHashes: string[],
): Map<string, CommitCommentTotals> {
    const [totals, setTotals] = useState<Map<string, CommitCommentTotals>>(new Map());

    // Stable key for the hash list so the effect only re-runs when the
    // set of commits actually changes.
    const commitsKey = commitHashes.join(',');

    const fetchTotals = useCallback(() => {
        if (!wsId || !commitsKey) {
            setTotals(new Map());
            return;
        }
        const params = new URLSearchParams({ commits: commitsKey });
        fetch(`${getApiBase()}/diff-comment-totals/${encodeURIComponent(wsId)}?${params}`)
            .then(res => (res.ok ? res.json() : Promise.reject(new Error('fetch failed'))))
            .then((data: { totals: Record<string, { open: number; resolved: number }> }) => {
                const map = new Map<string, CommitCommentTotals>();
                for (const [k, v] of Object.entries(data.totals)) {
                    if (v.open > 0 || v.resolved > 0) map.set(k, v);
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
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${protocol}://${window.location.host}${getWsPath()}`);
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
