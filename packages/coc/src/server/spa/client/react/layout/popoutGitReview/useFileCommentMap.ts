/**
 * Maps diff-comment storage keys onto file paths for a pop-out review.
 *
 * Commit and branch-range pop-outs both need "how many comments does this file
 * have?" badges, and both must derive the key from the same (workspace, oldRef,
 * newRef, path) tuple the comment store uses. Keeping that in one hook stops a
 * ref change in one review type from silently leaving the other with stale
 * badge counts.
 */

import { useEffect, useState } from 'react';
import { useFileCommentCounts } from '../../features/git/hooks/useFileCommentCounts';
import { computeDiffCommentKey } from '../../../comments/diff-comment-utils';

export function useFileCommentMap(
    workspaceId: string,
    oldRef: string,
    newRef: string,
    files: ReadonlyArray<{ path: string }>,
): Map<string, number> {
    const [fileCommentMap, setFileCommentMap] = useState<Map<string, number>>(new Map());
    const commentCounts = useFileCommentCounts(workspaceId, oldRef, newRef);

    // Stable dep: the mapping only needs to re-run when the set of paths changes.
    const pathsKey = files.map(file => file.path).join('\n');

    useEffect(() => {
        const paths = pathsKey ? pathsKey.split('\n') : [];
        if (commentCounts.size === 0 || paths.length === 0) {
            setFileCommentMap(new Map());
            return;
        }
        let cancelled = false;
        (async () => {
            const map = new Map<string, number>();
            for (const path of paths) {
                const key = await computeDiffCommentKey(workspaceId, oldRef, newRef, path);
                const count = commentCounts.get(key) ?? 0;
                if (count > 0) map.set(path, count);
            }
            if (!cancelled) setFileCommentMap(map);
        })();
        return () => { cancelled = true; };
    }, [commentCounts, pathsKey, workspaceId, oldRef, newRef]);

    return fileCommentMap;
}
