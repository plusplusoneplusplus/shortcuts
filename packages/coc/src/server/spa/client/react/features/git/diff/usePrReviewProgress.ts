/**
 * usePrReviewProgress
 *
 * PR popout review-progress hook (AC-03 + AC-04).
 *
 * Tracks two sets of file paths:
 *   - visitedFiles: any file the reviewer has opened
 *   - reviewedFiles: any file the reviewer has explicitly marked reviewed
 *
 * Opening a file marks it visited but never reviewed. A file becomes reviewed
 * only when the reviewer clicks the Mark reviewed action.
 *
 * State resets automatically whenever the headSha changes — stale progress for
 * a previous PR head must never apply to the new head.
 *
 * When `persistence` options are supplied the hook also loads progress from
 * `GET /api/repos/:repoId/pull-requests/:prId/review-progress?headSha=…` on
 * mount / headSha change and writes back via debounced
 * `PUT /api/repos/:repoId/pull-requests/:prId/review-progress`. The fetch
 * stale-head reset is handled server-side: when stored headSha does not
 * match the requested one the server returns empty sets.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    fetchReviewProgress,
    putReviewProgress,
    type ReviewProgressClientKey,
} from './reviewProgressApi';

export interface PrReviewProgressState {
    /** Files the reviewer has opened during this session. */
    visitedFiles: ReadonlySet<string>;
    /** Files explicitly marked reviewed by the reviewer. */
    reviewedFiles: ReadonlySet<string>;
    /** The headSha currently scoping this progress. */
    headSha: string | undefined;
    /** True once the persisted record (if any) has been merged in. */
    hydrated: boolean;
}

export interface UsePrReviewProgressReturn {
    state: PrReviewProgressState;
    isReviewed: (filePath: string) => boolean;
    isVisited: (filePath: string) => boolean;
    markVisited: (filePath: string) => void;
    markReviewed: (filePath: string) => void;
    unmarkReviewed: (filePath: string) => void;
    toggleReviewed: (filePath: string) => void;
    /** Inform the hook of the current selection so it can be persisted. */
    setLastSelectedFile: (filePath: string | null) => void;
}

export interface UsePrReviewProgressOptions {
    /**
     * When provided, the hook will hydrate from and persist to the server.
     * `null` / `undefined` keeps the hook fully in-memory.
     */
    persistence?: ReviewProgressClientKey | null;
    /** Debounce window (ms) for PUTs. Defaults to 400ms. */
    persistDebounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 400;

/**
 * @param headSha The PR head SHA currently in view. When this changes the
 *   visited/reviewed sets are cleared and (when persistence is configured)
 *   the server record for the new head is loaded.
 */
export function usePrReviewProgress(
    headSha: string | undefined,
    options?: UsePrReviewProgressOptions,
): UsePrReviewProgressReturn {
    const [visitedFiles, setVisitedFiles] = useState<ReadonlySet<string>>(() => new Set<string>());
    const [reviewedFiles, setReviewedFiles] = useState<ReadonlySet<string>>(() => new Set<string>());
    const [lastSelectedFile, setLastSelectedFileState] = useState<string | null>(null);
    const [hydrated, setHydrated] = useState(false);

    const persistence = options?.persistence ?? undefined;
    const persistDebounceMs = options?.persistDebounceMs ?? DEFAULT_DEBOUNCE_MS;

    // Stable string key for effect deps (avoids re-running when caller rebuilds
    // the object identity each render).
    const persistenceKey = persistence
        ? `${persistence.workspaceId}|${persistence.repoId}|${persistence.prId}`
        : '';

    // Tracks the last serialized payload that was sent to the server so the
    // post-hydration render does not immediately re-PUT the freshly-fetched
    // record back. Also short-circuits redundant PUTs after no-op renders.
    const lastPersistedRef = useRef<string>('');

    // Reset on headSha change. Empty headSha (undefined) also resets to keep
    // behavior consistent until the PR data has loaded.
    useEffect(() => {
        setVisitedFiles(new Set<string>());
        setReviewedFiles(new Set<string>());
        setLastSelectedFileState(null);
        setHydrated(false);
        lastPersistedRef.current = '';
    }, [headSha]);

    // Hydrate from server when persistence is configured. The fetch is keyed
    // on (persistence, headSha) — a different head triggers a re-hydration so
    // stale progress never bleeds into the new head's session.
    useEffect(() => {
        if (!persistence || !headSha) {
            // Without persistence we are immediately "hydrated" (in-memory only).
            if (!persistence) setHydrated(true);
            return;
        }
        let cancelled = false;
        fetchReviewProgress(persistence, headSha)
            .then(dto => {
                if (cancelled) return;
                if (dto.headSha === headSha) {
                    setVisitedFiles(new Set<string>(dto.visitedFiles));
                    setReviewedFiles(new Set<string>(dto.reviewedFiles));
                    setLastSelectedFileState(dto.lastSelectedFile);
                    // Seed the "last persisted" marker so the post-hydration
                    // render doesn't immediately PUT the same record back.
                    lastPersistedRef.current = JSON.stringify({
                        r: [...dto.reviewedFiles].sort(),
                        v: [...dto.visitedFiles].sort(),
                        s: dto.lastSelectedFile,
                        h: headSha,
                    });
                } else {
                    // Stale-head: leave empty sets, seed marker with empty
                    // shape so we don't PUT empty over the new head until the
                    // reviewer actually changes something.
                    lastPersistedRef.current = JSON.stringify({
                        r: [], v: [], s: null, h: headSha,
                    });
                }
                setHydrated(true);
            })
            .catch(() => {
                if (cancelled) return;
                // Fetch failed: keep empty state, mark hydrated so subsequent
                // PUTs can flow. Don't block the reviewer on a transient error.
                setHydrated(true);
            });
        return () => { cancelled = true; };
    }, [persistenceKey, headSha]); // eslint-disable-line react-hooks/exhaustive-deps

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

    const setLastSelectedFile = useCallback((filePath: string | null) => {
        setLastSelectedFileState(prev => (prev === filePath ? prev : filePath));
    }, []);

    // Debounced persistence. We avoid writing during the initial hydration —
    // otherwise the empty state we mount with would overwrite the server
    // record before the GET response merges in. Tracks the latest snapshot
    // in a ref to keep the timer cheap. A separate ref records the
    // last-persisted payload so the post-hydration render doesn't immediately
    // re-PUT the freshly fetched record back to the server.
    const latestSnapshotRef = useRef<{
        visited: ReadonlySet<string>;
        reviewed: ReadonlySet<string>;
        lastSelectedFile: string | null;
    }>({ visited: visitedFiles, reviewed: reviewedFiles, lastSelectedFile });
    latestSnapshotRef.current = { visited: visitedFiles, reviewed: reviewedFiles, lastSelectedFile };

    useEffect(() => {
        if (!persistence || !headSha || !hydrated) return;
        const snapshotKey = JSON.stringify({
            r: Array.from(reviewedFiles).sort(),
            v: Array.from(visitedFiles).sort(),
            s: lastSelectedFile,
            h: headSha,
        });
        if (snapshotKey === lastPersistedRef.current) return;
        const timer = setTimeout(() => {
            const snap = latestSnapshotRef.current;
            const payloadKey = JSON.stringify({
                r: Array.from(snap.reviewed).sort(),
                v: Array.from(snap.visited).sort(),
                s: snap.lastSelectedFile,
                h: headSha,
            });
            lastPersistedRef.current = payloadKey;
            putReviewProgress(persistence, {
                headSha,
                reviewedFiles: Array.from(snap.reviewed),
                visitedFiles: Array.from(snap.visited),
                lastSelectedFile: snap.lastSelectedFile,
            }).catch(() => { /* swallow transient errors */ });
        }, persistDebounceMs);
        return () => clearTimeout(timer);
    }, [persistenceKey, headSha, hydrated, visitedFiles, reviewedFiles, lastSelectedFile, persistDebounceMs]); // eslint-disable-line react-hooks/exhaustive-deps

    const state = useMemo<PrReviewProgressState>(
        () => ({ visitedFiles, reviewedFiles, headSha, hydrated }),
        [visitedFiles, reviewedFiles, headSha, hydrated],
    );

    return {
        state,
        isReviewed,
        isVisited,
        markVisited,
        markReviewed,
        unmarkReviewed,
        toggleReviewed,
        setLastSelectedFile,
    };
}

