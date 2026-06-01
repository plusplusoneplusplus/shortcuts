/**
 * Hook that checks which commits in a list have already been classified.
 *
 * Issues a single batch-status request instead of one request per commit.
 * Returns a stable Set of commit hashes whose classification result exists on
 * the server, plus a `refresh()` callback to re-check after a new
 * classification has been triggered.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { requestSpaApi } from '../../../api/cocClient';

interface BatchStatusResponse {
    statuses: Record<string, 'none' | 'ready' | 'running'>;
}

export interface UseCommitClassificationStatusReturn {
    /** Set of commit hashes whose classification result is stored. */
    classifiedHashes: ReadonlySet<string>;
    /** Re-fetch statuses from the server. */
    refresh: () => void;
}

/**
 * Fetch batch classification status for a list of commit hashes.
 *
 * @param workspaceId  Workspace / repo scope for the query.
 * @param repoId       Repo identifier (used in the REST path).
 * @param hashes       Commit hashes to check. Skips the request when empty.
 */
export function useCommitClassificationStatus(
    workspaceId: string,
    repoId: string,
    hashes: string[],
): UseCommitClassificationStatusReturn {
    const [classifiedHashes, setClassifiedHashes] = useState<ReadonlySet<string>>(new Set());
    // Stable join used as effect dependency — avoids re-fetching on reference changes.
    const sortedJoin = hashes.length > 0 ? [...hashes].sort().join(',') : '';
    const refreshCountRef = useRef(0);
    const [refreshTick, setRefreshTick] = useState(0);

    useEffect(() => {
        if (!repoId || sortedJoin === '') {
            setClassifiedHashes(new Set());
            return;
        }

        let cancelled = false;
        const params = new URLSearchParams({
            type: 'commit',
            identifiers: sortedJoin,
            ...(workspaceId && workspaceId !== repoId ? { workspaceId } : {}),
        });

        requestSpaApi<BatchStatusResponse>(
            `/repos/${encodeURIComponent(repoId)}/classify-diff/batch-status?${params.toString()}`,
        )
            .then(resp => {
                if (cancelled) return;
                const ready = new Set<string>();
                for (const [hash, status] of Object.entries(resp.statuses)) {
                    if (status === 'ready') ready.add(hash);
                }
                setClassifiedHashes(ready);
            })
            .catch(() => { /* best-effort — leave previous state */ });

        return () => { cancelled = true; };
    }, [repoId, workspaceId, sortedJoin, refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

    const refresh = useCallback(() => {
        refreshCountRef.current += 1;
        setRefreshTick(t => t + 1);
    }, []);

    return { classifiedHashes, refresh };
}
