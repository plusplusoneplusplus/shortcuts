/**
 * Generic classification hook for any DiffSource.
 *
 * Accepts a `ClassificationKey` (type + repoId + identifier) and exposes
 * the same filter/badge/lookup API as the old PR-specific hook.
 *
 * AI provider / model / reasoning-effort selection is driven externally via
 * the `aiSelection` parameter — callers should use `useModalJobAiSelection`
 * at the component level and pass its `.resolved` value here.
 *
 * API endpoints used:
 *   POST /api/origins/:originId/classify-diff — trigger PR classification
 *   GET  /api/origins/:originId/classify-diff — get cached PR result / poll
 *   POST /api/repos/:repoId/classify-diff     — trigger commit/branch classification
 *   GET  /api/repos/:repoId/classify-diff     — get cached commit/branch result / poll
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
    DiffClassificationResult,
    HunkCategory,
    HunkClassification,
    HunkIntensity,
} from '../../pull-requests/classification-types';
import { classificationPriority } from '../../pull-requests/classification-types';
import { toSpaCocRequestOptions, translateSpaCocClientError } from '../../../api/cocClient';
import { useCocClient } from '../../../repos/cloneRouting';
import type { ClassificationKey } from './diffSource';
import type { ResolvedModalJobAiSelection } from '../../../shared/ModalJobAiControls';

// ── Public types ──────────────────────────────────────────────────────

/** AI provider identifier (mirrors server ChatProvider). */
export type ChatProvider = 'copilot' | 'codex' | 'claude';

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
    /** True when any hunk in the file is marked as a critical existing-function change. */
    hasCritical?: boolean;
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
// Shared with the diff viewer via `classificationPriority` so the file-tree
// badge and the rendered hunk always agree on the dominant classification.

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

/**
 * Generic classification hook that works with any DiffSource via ClassificationKey.
 *
 * Pass `undefined` as the key to disable (no API calls, idle state).
 * AI provider / model / reasoning-effort come from the `aiSelection` parameter;
 * callers should obtain it from `useModalJobAiSelection` at the component level.
 */
export function useClassification(
    classificationKey: ClassificationKey | undefined,
    aiSelection: ResolvedModalJobAiSelection,
    options?: { workspaceId?: string },
): UseClassificationReturn {
    const workspaceId = options?.workspaceId;

    // Route classify-diff REST to the workspace's clone server (AC-07). A remote
    // clone hits its own origin; a local/unknown id resolves to the default.
    // Mirrors requestSpaApi's error translation so behavior is unchanged locally.
    const cloneClient = useCocClient(workspaceId);
    const requestApi = useCallback(
        async <T,>(path: string, opts?: RequestInit): Promise<T> => {
            try {
                return await cloneClient.request<T>(path, toSpaCocRequestOptions(opts));
            } catch (error) {
                translateSpaCocClientError(error);
            }
        },
        [cloneClient],
    );

    const [state, setState] = useState<ClassificationState>({
        status: 'idle',
        activeFilters: new Set<HunkCategory>(['logic']),
    });

    // Track the latest aiSelection in a ref so classify() always uses the most
    // recent values without re-creating the callback on every AI-selection change.
    const aiSelectionRef = useRef<ResolvedModalJobAiSelection>(aiSelection);
    aiSelectionRef.current = aiSelection;

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollCount = useRef(0);
    // Tracks the "live" key string so stale async closures can self-abort.
    const currentKeyRef = useRef<string>('');

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
                const hasCritical = hunks.some(h => h.critical !== undefined);
                for (const h of hunks) {
                    const pri = classificationPriority(h);
                    if (pri > maxPri) {
                        maxPri = pri;
                        badge = { category: h.category, intensity: h.intensity };
                    }
                }
                if (hasCritical) {
                    badge = { ...badge, hasCritical };
                }
                badges.set(file, badge);
            }
        }
        indexRef.current = { byFile, byHunk, badges };
    }, [state.result]);

    // Stable stringified key for dependency tracking
    const keyStr = classificationKey
        ? [
            classificationKey.type,
            classificationKey.repoId,
            classificationKey.identifier,
            classificationKey.originId ?? '',
            classificationKey.workspaceId ?? workspaceId ?? '',
        ].join(':')
        : '';

    // On key change: update the live-key guard, stop any in-flight polling, and
    // reset hook state so the new PR always starts from a clean slate.
    // The cleanup function runs both on key change AND on unmount, so there is no
    // separate mount-only cleanup effect needed.
    useEffect(() => {
        currentKeyRef.current = keyStr;
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        pollCount.current = 0;
        setState({
            status: 'idle',
            activeFilters: new Set<HunkCategory>(['logic']),
        });
        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [keyStr]);

    const buildUrl = useCallback((suffix: string) => {
        if (!classificationKey) return '';
        const base = classificationKey.type === 'pr' && classificationKey.originId
            ? `/origins/${encodeURIComponent(classificationKey.originId)}/classify-diff`
            : `/repos/${encodeURIComponent(classificationKey.repoId)}/classify-diff`;
        return `${base}${suffix}`;
    }, [keyStr]);

    const addOriginMetadata = useCallback((params: URLSearchParams | Record<string, unknown>) => {
        if (!classificationKey?.originId) return;
        const metadataWorkspaceId = classificationKey.workspaceId ?? workspaceId;
        if (params instanceof URLSearchParams) {
            if (metadataWorkspaceId) params.set('workspaceId', metadataWorkspaceId);
            params.set('repoId', classificationKey.repoId);
            return;
        }
        if (metadataWorkspaceId) params.workspaceId = metadataWorkspaceId;
        params.repoId = classificationKey.repoId;
    }, [keyStr, workspaceId]);

    const startPolling = useCallback(() => {
        if (!classificationKey) return;
        if (pollRef.current) clearInterval(pollRef.current);
        pollCount.current = 0;

        const ck = classificationKey;
        const capturedKeyStr = keyStr;
        pollRef.current = setInterval(async () => {
            // Abort if the key has changed (user navigated to another PR).
            if (currentKeyRef.current !== capturedKeyStr) {
                if (pollRef.current) clearInterval(pollRef.current);
                pollRef.current = null;
                return;
            }
            pollCount.current++;
            if (pollCount.current > MAX_POLLS) {
                if (pollRef.current) clearInterval(pollRef.current);
                setState(prev => ({ ...prev, status: 'error', error: 'Classification timed out' }));
                return;
            }
            try {
                const params = new URLSearchParams({
                    type: ck.type,
                    identifier: ck.identifier,
                });
                addOriginMetadata(params);
                const resp = await requestApi<ClassificationGetResponse>(
                    buildUrl(`?${params.toString()}`),
                );
                if (currentKeyRef.current !== capturedKeyStr) return; // stale — drop
                if (resp.status === 'ready' && resp.result) {
                    if (pollRef.current) clearInterval(pollRef.current);
                    setState(prev => ({ ...prev, status: 'ready', result: resp.result, error: undefined }));
                }
                // 'running' or 'none' — keep polling
            } catch {
                // Transient error — keep polling
            }
        }, POLL_INTERVAL);
    }, [keyStr, buildUrl, addOriginMetadata, requestApi]);

    const classify = useCallback(() => {
        if (!classificationKey) return;
        const ck = classificationKey;
        const capturedKeyStr = keyStr;

        setState(prev => ({ ...prev, status: 'loading', error: undefined }));

        const ai = aiSelectionRef.current;
        const postBody: Record<string, unknown> = {
            type: ck.type,
            identifier: ck.identifier,
        };
        addOriginMetadata(postBody);
        if (ai.provider) postBody.provider = ai.provider;
        if (ai.model) postBody.model = ai.model;
        if (ai.reasoningEffort) postBody.reasoningEffort = ai.reasoningEffort;
        if (ai.effortTier) postBody.effortTier = ai.effortTier;
        if (ai.autoProviderRouting) postBody.autoProviderRouting = true;

        requestApi<ClassifyResponse>(
            buildUrl(''),
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(postBody),
            },
        )
            .then(resp => {
                if (currentKeyRef.current !== capturedKeyStr) return; // stale — drop
                if (resp.status === 'ready' && resp.result) {
                    setState(prev => ({ ...prev, status: 'ready', result: resp.result, error: undefined }));
                } else {
                    // Started or running — begin polling
                    startPolling();
                }
            })
            .catch(err => {
                if (currentKeyRef.current !== capturedKeyStr) return; // stale — drop
                setState(prev => ({
                    ...prev,
                    status: 'error',
                    error: err instanceof Error ? err.message : 'Classification failed',
                }));
            });
    }, [keyStr, buildUrl, addOriginMetadata, startPolling, requestApi]);

    // On mount / key change, check for cached result
    useEffect(() => {
        if (!classificationKey) return;
        const ck = classificationKey;
        const capturedKeyStr = keyStr;

        const params = new URLSearchParams({
            type: ck.type,
            identifier: ck.identifier,
        });
        addOriginMetadata(params);
        requestApi<ClassificationGetResponse>(
            buildUrl(`?${params.toString()}`),
        )
            .then(resp => {
                if (currentKeyRef.current !== capturedKeyStr) return; // stale — drop
                if (resp.status === 'ready' && resp.result) {
                    setState(prev => ({ ...prev, status: 'ready', result: resp.result }));
                } else if (resp.status === 'running') {
                    setState(prev => ({ ...prev, status: 'loading' }));
                    startPolling();
                }
            })
            .catch(() => { /* no cache — ok */ });
    }, [keyStr, buildUrl, addOriginMetadata, startPolling, requestApi]);

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
