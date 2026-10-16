import { useEffect, useState } from 'react';
import type { GitFileChange } from '@plusplusoneplusplus/coc-client';
import { getGitReviewClient } from '../diff/diffSource';

/** Metadata only: never download a combined patch to populate navigation. */
export function useCommitReviewFiles(workspaceId: string, hash: string | undefined, owner?: string) {
    const key = JSON.stringify([owner ?? workspaceId, workspaceId, hash]);
    const [attempt, retry] = useState(0);
    const [state, setState] = useState<{ key: string; files: GitFileChange[]; loading: boolean; error?: string }>({ key, files: [], loading: !!hash });
    useEffect(() => {
        let cancelled = false;
        setState({ key, files: [], loading: !!hash });
        if (hash) {
            Promise.resolve().then(() => getGitReviewClient(workspaceId, owner === workspaceId ? null : owner).git.listCommitFiles(workspaceId, hash))
                .then(data => { if (!cancelled) setState({ key, files: data.files ?? [], loading: false }); })
                .catch(error => { if (!cancelled) setState({ key, files: [], loading: false, error: error.message || 'Failed to load files' }); });
        }
        return () => { cancelled = true; };
    }, [key, workspaceId, hash, attempt]);
    return { ...(state.key === key ? state : { files: [], loading: !!hash, error: undefined }), retry: () => retry(n => n + 1) };
}
