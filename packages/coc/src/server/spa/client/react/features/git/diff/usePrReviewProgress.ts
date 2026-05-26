/**
 * usePrReviewProgress
 *
 * In-memory PR popout review-progress hook (AC-03).
 *
 * Tracks two sets of file paths:
 *   - visitedFiles: any file the reviewer has opened
 *   - reviewedFiles: any file the reviewer has explicitly marked reviewed
 *
 * Opening a file marks it visited but never reviewed. A file becomes reviewed
 * only when the reviewer clicks the Mark reviewed action.
 *
 * State resets automatically whenever the headSha changes — stale progress for
 * a previous PR head must never apply to the new head. Persistence (AC-04)
 * will layer on top of this hook later.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export interface PrReviewProgressState {
    /** Files the reviewer has opened during this session. */
    visitedFiles: ReadonlySet<string>;
    /** Files explicitly marked reviewed by the reviewer. */
    reviewedFiles: ReadonlySet<string>;
    /** The headSha currently scoping this progress. */
    headSha: string | undefined;
}

export interface UsePrReviewProgressReturn {
    state: PrReviewProgressState;
    isReviewed: (filePath: string) => boolean;
    isVisited: (filePath: string) => boolean;
    markVisited: (filePath: string) => void;
    markReviewed: (filePath: string) => void;
    unmarkReviewed: (filePath: string) => void;
    toggleReviewed: (filePath: string) => void;
}

/**
 * @param headSha The PR head SHA currently in view. When this changes the
 *   visited/reviewed sets are cleared.
 */
export function usePrReviewProgress(headSha: string | undefined): UsePrReviewProgressReturn {
    const [visitedFiles, setVisitedFiles] = useState<ReadonlySet<string>>(() => new Set<string>());
    const [reviewedFiles, setReviewedFiles] = useState<ReadonlySet<string>>(() => new Set<string>());

    // Reset on headSha change. Empty headSha (undefined) also resets to keep
    // behavior consistent until the PR data has loaded.
    useEffect(() => {
        setVisitedFiles(new Set<string>());
        setReviewedFiles(new Set<string>());
    }, [headSha]);

    const markVisited = useCallback((filePath: string) => {
        if (!filePath) return;
        setVisitedFiles(prev => {
            if (prev.has(filePath)) return prev;
            const next = new Set(prev);
            next.add(filePath);
            return next;
        });
    }, []);

    const markReviewed = useCallback((filePath: string) => {
        if (!filePath) return;
        setReviewedFiles(prev => {
            if (prev.has(filePath)) return prev;
            const next = new Set(prev);
            next.add(filePath);
            return next;
        });
        // Reviewing implies visited.
        setVisitedFiles(prev => {
            if (prev.has(filePath)) return prev;
            const next = new Set(prev);
            next.add(filePath);
            return next;
        });
    }, []);

    const unmarkReviewed = useCallback((filePath: string) => {
        if (!filePath) return;
        setReviewedFiles(prev => {
            if (!prev.has(filePath)) return prev;
            const next = new Set(prev);
            next.delete(filePath);
            return next;
        });
    }, []);

    const toggleReviewed = useCallback((filePath: string) => {
        if (!filePath) return;
        setReviewedFiles(prev => {
            const next = new Set(prev);
            if (next.has(filePath)) {
                next.delete(filePath);
            } else {
                next.add(filePath);
            }
            return next;
        });
        setVisitedFiles(prev => {
            if (prev.has(filePath)) return prev;
            const next = new Set(prev);
            next.add(filePath);
            return next;
        });
    }, []);

    const isReviewed = useCallback((filePath: string) => reviewedFiles.has(filePath), [reviewedFiles]);
    const isVisited = useCallback((filePath: string) => visitedFiles.has(filePath), [visitedFiles]);

    const state = useMemo<PrReviewProgressState>(
        () => ({ visitedFiles, reviewedFiles, headSha }),
        [visitedFiles, reviewedFiles, headSha],
    );

    return { state, isReviewed, isVisited, markVisited, markReviewed, unmarkReviewed, toggleReviewed };
}
