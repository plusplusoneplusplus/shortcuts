/**
 * React hook for managing PR diff classification state.
 *
 * Calls the classification REST API to trigger on-demand classification
 * and poll for results.  Exposes per-file and per-hunk lookup helpers
 * consumed by PrFilesPanel for filter-bar, badges, and hunk dimming.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
    DiffClassificationResult,
    HunkCategory,
    HunkClassification,
    HunkIntensity,
} from './classification-types';
import { HUNK_CATEGORIES } from './classification-types';
import { requestSpaApi } from '../../api/cocClient';

// ── Public types ──────────────────────────────────────────────────────

export type ClassificationStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ClassificationState {
    /** Current status of the classification process. */
    status: ClassificationStatus;
    /** Human-readable error message (set when status === 'error'). */
    error?: string;
    /** Full classification result (set when status === 'ready'). */
    result?: DiffClassificationResult;
    /** Which categories are checked in the filter bar. */
    activeFilters: Set<HunkCategory>;
}

/** Per-file badge info (max intensity across all hunks in the file). */
export interface FileBadge {
    /** Dominant category (highest-priority among hunks). */
    category: HunkCategory;
    /** Max intensity across all hunks in this file. */
    intensity: HunkIntensity;
}

export interface UseClassificationReturn {
    state: ClassificationState;
    /** Trigger classification via REST API. */
    classify: () => void;
    /** Toggle a filter category on/off. */
    toggleFilter: (cat: HunkCategory) => void;
    /** Set all filter categories at once. */
    setFilters: (cats: Set<HunkCategory>) => void;
    /** Look up the badge for a file path (undefined if not classified). */
    getFileBadge: (filePath: string) => FileBadge | undefined;
    /** Look up a specific hunk's classification. */
    getHunkClassification: (filePath: string, hunkIndex: number) => HunkClassification | undefined;
    /** Whether a hunk should be dimmed (classified but not in active filters). */
    isHunkDimmed: (filePath: string, hunkIndex: number) => boolean;
    /** Whether a file should be dimmed (all its hunks are in unchecked categories). */
    isFileDimmed: (filePath: string) => boolean;
}

// ── Category priority for badge display ───────────────────────────────

const CATEGORY_PRIORITY: Record<HunkCategory, number> = {
    logic: 3,
    test: 2,
    mechanical: 1,
    generated: 0,
};

// ── API response shapes ───────────────────────────────────────────────

interface ClassifyResponse {
    status: 'started' | 'ready' | 'running';
    taskId?: string;
    processId?: string;
    result?: DiffClassificationResult;
}

interface ClassificationGetResponse {
    status: 'none' | 'ready' | 'running';
    processId?: string;
    result?: DiffClassificationResult;
}

// ── Hook ──────────────────────────────────────────────────────────────

const POLL_INTERVAL = 3_000;
const MAX_POLLS = 200; // 10 min max

export function useClassification(
    repoId: string | undefined,
    prId: string | number | undefined,
    headSha: string | undefined,
): UseClassificationReturn {
    const [state, setState] = useState<ClassificationState>({
        status: 'idle',
        activeFilters: new Set<HunkCategory>(['logic']),
    });

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollCount = useRef(0);

    // Stop polling on unmount
    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    // Build indices for fast lookup
    const indexRef = useRef<{
        byFile: Map<string, HunkClassification[]>;
        byHunk: Map<string, HunkClassification>;
        badges: Map<string, FileBadge>;
    }>({ byFile: new Map(), byHunk: new Map(), badges: new Map() });

    useEffect(() => {
        const result = state.result;
        const byFile = new Map<string, HunkClassification[]>();
        const byHunk = new Map<string, HunkClassification>();
        const badges = new Map<string, FileBadge>();

        if (result) {
            for (const c of result.classifications) {
                const key = `${c.file}:${c.hunkIndex}`;
                byHunk.set(key, c);
                const arr = byFile.get(c.file) ?? [];
                arr.push(c);
                byFile.set(c.file, arr);
            }
            // Compute badges
            for (const [file, hunks] of byFile) {
                let maxPri = -1;
                let badge: FileBadge = { category: 'mechanical', intensity: 'low' };
                for (const h of hunks) {
                    const pri = CATEGORY_PRIORITY[h.category] * 2 + (h.intensity === 'high' ? 1 : 0);
                    if (pri > maxPri) {
                        maxPri = pri;
                        badge = { category: h.category, intensity: h.intensity };
                    }
                }
                badges.set(file, badge);
            }
        }
        indexRef.current = { byFile, byHunk, badges };
    }, [state.result]);

    const startPolling = useCallback((rId: string, pId: string, sha: string) => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollCount.current = 0;

        pollRef.current = setInterval(async () => {
            pollCount.current++;
            if (pollCount.current > MAX_POLLS) {
                if (pollRef.current) clearInterval(pollRef.current);
                setState(prev => ({ ...prev, status: 'error', error: 'Classification timed out' }));
                return;
            }
            try {
                const resp = await requestSpaApi<ClassificationGetResponse>(
                    `/repos/${encodeURIComponent(rId)}/pull-requests/${encodeURIComponent(pId)}/classification?headSha=${encodeURIComponent(sha)}`,
                );
                if (resp.status === 'ready' && resp.result) {
                    if (pollRef.current) clearInterval(pollRef.current);
                    setState(prev => ({ ...prev, status: 'ready', result: resp.result, error: undefined }));
                }
                // 'running' or 'none' — keep polling
            } catch {
                // Transient error — keep polling
            }
        }, POLL_INTERVAL);
    }, []);

    const classify = useCallback(() => {
        if (!repoId || !prId || !headSha) return;
        const rId = String(repoId);
        const pId = String(prId);

        setState(prev => ({ ...prev, status: 'loading', error: undefined }));

        requestSpaApi<ClassifyResponse>(
            `/repos/${encodeURIComponent(rId)}/pull-requests/${encodeURIComponent(pId)}/classify`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ headSha }),
            },
        )
            .then(resp => {
                if (resp.status === 'ready' && resp.result) {
                    setState(prev => ({ ...prev, status: 'ready', result: resp.result, error: undefined }));
                } else {
                    // Started or running — begin polling
                    startPolling(rId, pId, headSha);
                }
            })
            .catch(err => {
                setState(prev => ({
                    ...prev,
                    status: 'error',
                    error: err instanceof Error ? err.message : 'Classification failed',
                }));
            });
    }, [repoId, prId, headSha, startPolling]);

    // On mount, check for cached result
    useEffect(() => {
        if (!repoId || !prId || !headSha) return;
        const rId = String(repoId);
        const pId = String(prId);

        requestSpaApi<ClassificationGetResponse>(
            `/repos/${encodeURIComponent(rId)}/pull-requests/${encodeURIComponent(pId)}/classification?headSha=${encodeURIComponent(headSha)}`,
        )
            .then(resp => {
                if (resp.status === 'ready' && resp.result) {
                    setState(prev => ({ ...prev, status: 'ready', result: resp.result }));
                } else if (resp.status === 'running') {
                    setState(prev => ({ ...prev, status: 'loading' }));
                    startPolling(rId, pId, headSha);
                }
            })
            .catch(() => { /* no cache — ok */ });
    }, [repoId, prId, headSha, startPolling]);

    const toggleFilter = useCallback((cat: HunkCategory) => {
        setState(prev => {
            const next = new Set(prev.activeFilters);
            if (next.has(cat)) next.delete(cat);
            else next.add(cat);
            return { ...prev, activeFilters: next };
        });
    }, []);

    const setFilters = useCallback((cats: Set<HunkCategory>) => {
        setState(prev => ({ ...prev, activeFilters: cats }));
    }, []);

    const getFileBadge = useCallback((filePath: string): FileBadge | undefined => {
        return indexRef.current.badges.get(filePath);
    }, []);

    const getHunkClassification = useCallback((filePath: string, hunkIndex: number): HunkClassification | undefined => {
        return indexRef.current.byHunk.get(`${filePath}:${hunkIndex}`);
    }, []);

    const isHunkDimmed = useCallback((filePath: string, hunkIndex: number): boolean => {
        if (state.status !== 'ready') return false;
        const c = indexRef.current.byHunk.get(`${filePath}:${hunkIndex}`);
        if (!c) return false;
        return !state.activeFilters.has(c.category);
    }, [state.status, state.activeFilters]);

    const isFileDimmed = useCallback((filePath: string): boolean => {
        if (state.status !== 'ready') return false;
        const hunks = indexRef.current.byFile.get(filePath);
        if (!hunks || hunks.length === 0) return false;
        return hunks.every(h => !state.activeFilters.has(h.category));
    }, [state.status, state.activeFilters]);

    return {
        state,
        classify,
        toggleFilter,
        setFilters,
        getFileBadge,
        getHunkClassification,
        isHunkDimmed,
        isFileDimmed,
    };
}
