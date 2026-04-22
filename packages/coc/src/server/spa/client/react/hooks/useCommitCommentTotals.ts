/**
 * useCommitCommentTotals — fetch open and resolved comment counts per commit hash.
 *
 * Calls GET /api/diff-comment-totals/:wsId?commits=hash1,hash2,... twice
 * (once for status=open, once for status=resolved) and returns a
 * Map<commitHash, { open: number; resolved: number }>.
 * Returns an empty Map while loading or on error — comment counts are
 * non-critical and should never break the UI.
 *
 * Automatically refreshes when wsId or the set of commit hashes changes.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase, getWsPath } from '../utils/config';

export interface CommitCommentCounts {
    open: number;
    resolved: number;
}

export function useCommitCommentTotals(
    wsId: string,
    commitHashes: string[],
): Map<string, CommitCommentCounts> {
    const [totals, setTotals] = useState<Map<string, CommitCommentCounts>>(new Map());

    // Stable key for the hash list so the effect only re-runs when the
    // set of commits actually changes.
    const commitsKey = commitHashes.join(',');

    const fetchTotals = useCallback(() => {
        if (!wsId || !commitsKey) {
            setTotals(new Map());
            return;
        }
        const base = `${getApiBase()}/diff-comment-totals/${encodeURIComponent(wsId)}`;
        const openParams = new URLSearchParams({ commits: commitsKey, status: 'open' });
        const resolvedParams = new URLSearchParams({ commits: commitsKey, status: 'resolved' });

        Promise.all([
            fetch(`${base}?${openParams}`)
                .then(res => (res.ok ? res.json() : Promise.reject(new Error('fetch failed'))))
                .then((data: { totals: Record<string, number> }) => data.totals),
            fetch(`${base}?${resolvedParams}`)
                .then(res => (res.ok ? res.json() : Promise.reject(new Error('fetch failed'))))
                .then((data: { totals: Record<string, number> }) => data.totals),
        ])
            .then(([openTotals, resolvedTotals]) => {
                const map = new Map<string, CommitCommentCounts>();
                const allKeys = new Set([...Object.keys(openTotals), ...Object.keys(resolvedTotals)]);
                for (const k of allKeys) {
                    const open = openTotals[k] ?? 0;
                    const resolved = resolvedTotals[k] ?? 0;
                    if (open > 0 || resolved > 0) {
                        map.set(k, { open, resolved });
                    }
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
