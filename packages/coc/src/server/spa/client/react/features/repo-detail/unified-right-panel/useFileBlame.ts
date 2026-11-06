/**
 * useFileBlame — reads one repo file's `HEAD` blame from the tab's owner
 * (`features.fileBlame`) while blame is shown.
 *
 * Reads go through the owner's own client (local id or remote clone key), never
 * the page-origin server. Answers for a previous owner/path, a reload, or a
 * blame view that was turned off are dropped.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitFileBlameResponse } from '@plusplusoneplusplus/coc-client';
import { getGitReviewClient } from '../../git/diff/diffSource';

export type FileBlameState =
    | { status: 'off' }
    | { status: 'loading' }
    | { status: 'error'; message: string; retry: () => void }
    | { status: 'loaded'; blame: GitFileBlameResponse };

export interface UseFileBlameOptions {
    /** Whether blame is shown; `false` drops any pending answer. */
    enabled: boolean;
    workspaceId: string;
    routingRef?: string | null;
    /** Repo-relative path. */
    filePath: string;
}

export function useFileBlame({ enabled, workspaceId, routingRef, filePath }: UseFileBlameOptions): FileBlameState {
    const [state, setState] = useState<FileBlameState>({ status: 'off' });
    const requestRef = useRef(0);

    const load = useCallback(() => {
        const request = ++requestRef.current;
        setState({ status: 'loading' });
        const fail = (reason: unknown) => {
            if (request !== requestRef.current) return;
            setState({ status: 'error', message: reason instanceof Error ? reason.message : String(reason), retry: load });
        };
        try {
            getGitReviewClient(workspaceId, routingRef).git.getFileBlame(workspaceId, filePath).then(
                blame => { if (request === requestRef.current) setState({ status: 'loaded', blame }); },
                fail,
            );
        } catch (reason) {
            fail(reason);
        }
    }, [workspaceId, routingRef, filePath]);

    useEffect(() => {
        if (!enabled) {
            requestRef.current++;
            setState({ status: 'off' });
            return;
        }
        load();
        return () => { requestRef.current++; };
    }, [enabled, load]);

    return state;
}
