/**
 * Window lifecycle for the pop-out git review shell: broadcast-channel
 * open/close notifications, restore handling, and the dynamic document title.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    useGitReviewPopOutChannel,
    type GitReviewPopOutMessage,
    gitReviewPopOutKey,
    gitReviewBranchPopOutKey,
    gitReviewPrPopOutKey,
} from '../../contexts/GitReviewPopOutContext';
import { getHostname } from '../../utils/config';
import { popOutGitReviewDocumentTitle, type PopOutGitReviewParams } from './popoutGitReviewRoute';

/** Channel key identifying this pop-out window to the opener tab. */
export function popOutGitReviewChannelKey(params: PopOutGitReviewParams): string {
    if (params.reviewType === 'commit') return gitReviewPopOutKey(params.workspaceId, params.commitHash!);
    if (params.reviewType === 'pr') return gitReviewPrPopOutKey(params.workspaceId, params.prId!);
    return gitReviewBranchPopOutKey(params.workspaceId);
}

export interface UsePopOutReviewLifecycleOptions {
    params: PopOutGitReviewParams;
    /** PR title once loaded; folded into the document title for PR reviews. */
    prTitle?: string;
}

export interface UsePopOutReviewLifecycleReturn {
    channelKey: string;
}

export function usePopOutReviewLifecycle({
    params,
    prTitle,
}: UsePopOutReviewLifecycleOptions): UsePopOutReviewLifecycleReturn {
    const hasNotifiedRef = useRef(false);
    const key = useMemo(() => popOutGitReviewChannelKey(params), [params]);

    const handleMessage = useCallback((msg: GitReviewPopOutMessage) => {
        if (msg.type === 'git-review-popout-restore' && msg.key === key) {
            window.close();
        }
    }, [key]);

    const { postMessage } = useGitReviewPopOutChannel(handleMessage);

    useEffect(() => {
        if (hasNotifiedRef.current) return;
        hasNotifiedRef.current = true;
        postMessage({ type: 'git-review-popout-opened', key });

        const handleBeforeUnload = () => {
            postMessage({ type: 'git-review-popout-closed', key });
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [key, postMessage]);

    useEffect(() => {
        document.title = popOutGitReviewDocumentTitle(params, { hostname: getHostname(), prTitle });
    }, [params, prTitle]);

    return { channelKey: key };
}
