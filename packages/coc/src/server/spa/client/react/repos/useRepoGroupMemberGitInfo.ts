/**
 * useRepoGroupMemberGitInfo — branch/dirty/ahead-behind badges for a group's
 * member repos, fetched the same way the repo grid fetches them.
 *
 * One `POST /api/git-info/batch` covers every member, rather than N individual
 * `git-info` calls: a group can hold a dozen repos and the picker shows all of
 * them at once. After that, a `git-changed` websocket event for one member
 * refreshes just that member — the same targeted refresh `ReposContext` does,
 * so a commit or push in the panel updates its own badge without re-reading the
 * whole group.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitInfoResponse } from '@plusplusoneplusplus/coc-client';
import { useWebSocket } from '../hooks/useWebSocket';
import { getWorkspaceGitInfo, getWorkspaceGitInfoBatch } from './repositoryService';

/** Badge data per member workspace id; a missing entry means "not loaded yet". */
export type RepoGroupMemberGitInfo = Record<string, GitInfoResponse | null>;

export function useRepoGroupMemberGitInfo(memberIds: readonly string[]): RepoGroupMemberGitInfo {
    const [info, setInfo] = useState<RepoGroupMemberGitInfo>({});
    // The effect must re-run when the membership changes, not on every render of
    // a freshly built array, so key it on the joined ids.
    const key = memberIds.join(',');
    // `git-changed` handling needs the current membership without resubscribing.
    const idsRef = useRef<readonly string[]>(memberIds);
    idsRef.current = memberIds;

    useEffect(() => {
        const ids = key ? key.split(',') : [];
        if (ids.length === 0) {
            setInfo({});
            return;
        }
        let cancelled = false;
        const abort = new AbortController();
        getWorkspaceGitInfoBatch(ids, abort.signal, 'initial-topology-load')
            .then(data => {
                if (!cancelled) setInfo(data?.results ?? {});
            })
            .catch(() => {
                // A failed batch just leaves the rows badge-less; the picker
                // still lists and selects members.
                if (!cancelled) setInfo({});
            });
        return () => {
            cancelled = true;
            abort.abort();
        };
    }, [key]);

    const onMessage = useCallback((msg: { type?: string; workspaceId?: string }) => {
        if (msg?.type !== 'git-changed' || !msg.workspaceId) return;
        const changed = msg.workspaceId;
        if (!idsRef.current.includes(changed)) return;
        getWorkspaceGitInfo(changed)
            .then(next => setInfo(prev => ({ ...prev, [changed]: next ?? null })))
            .catch(() => { /* keep the stale badge rather than blanking it */ });
    }, []);
    useWebSocket({ onMessage });

    return info;
}
