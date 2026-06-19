/**
 * usePrChatStatusItems — runtime data layer that closes AC-01 (detect + persist)
 * and feeds AC-02's {@link PrStatusCard}.
 *
 * Given a chat's loaded turns, workspace, remote URL, and task id this hook:
 *   1. resolves the chat's canonical origin (reusing {@link resolveCanonicalOriginId}),
 *   2. gathers PRs detected in the loaded turns (reusing the shared detection),
 *   3. fetches persisted bindings for this chat's task and unions them with the
 *      detected PRs (so a PR survives reload with its creating turn collapsed),
 *   4. upserts a binding for any freshly-detected PR not yet persisted
 *      (best-effort POST), and
 *   5. fetches PR detail per association, mapping it to a {@link PrStatusCardItem}
 *      with per-row loading / ready / error state and a retry.
 *
 * All the union / detection / origin logic lives in the pure
 * {@link ./prChatAssociation} module (unit-tested independently); this hook is the
 * thin async/React layer over it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientConversationTurn } from '../../../types/dashboard';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../../api/cocClient';
import { resolveCanonicalOriginId } from '../../../repos/originScope';
import { buildCheckRowsFromChecks } from '../../pull-requests/pr-derived-data';
import type { PullRequestCheck } from '../../pull-requests/pr-utils';
import {
    detectedPrsNeedingBinding,
    gatherDetectedPrsFromTurns,
    unionAssociations,
    type PrAssociation,
    type PrChatBindingLike,
} from './prChatAssociation';
import { PR_STATUS_POLL_INTERVAL_MS, shouldPollPrStatusItems } from './prStatusFreshness';
import type { PrAutoMergeInfo, PrStatusCardItem, PrStatusCardPr } from './PrStatusCard';

export interface UsePrChatStatusItemsOptions {
    /** Currently-loaded conversation turns (PRs are detected in their tool output). */
    turns: readonly ClientConversationTurn[] | undefined;
    /** Chat's owning workspace id (origin resolution + binding scope). */
    workspaceId: string | undefined;
    /** Workspace remote URL — resolves the chat's canonical origin for bindings. */
    remoteUrl: string | null | undefined;
    /** Chat's task id — scopes the persisted bindings (`task_id`). */
    taskId: string | undefined;
}

export interface UsePrChatStatusItemsResult {
    items: PrStatusCardItem[];
    /** Re-fetch a single failed row's detail. */
    retry: (key: string) => void;
    /** Lazily fetch a row's CI checks (AC-03) — called when its panel is expanded. */
    expandChecks: (key: string) => void;
    /**
     * Force-refresh every row's detail (and any already-loaded checks), bypassing
     * the server cache (AC-05). Used by the manual refresh control and smart poll.
     */
    refresh: () => void;
    /** True while a {@link refresh} is in flight (drives the refresh control's spinner). */
    refreshing: boolean;
    /** Epoch ms of the last successful detail fetch — feeds the "updated Xs ago" label. */
    lastUpdatedAt: number | undefined;
    /** Whether the smart poll is currently active (a PR is non-terminal + unsettled). */
    isPolling: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

/**
 * Maps the canonical `PullRequestAutoMerge` payload to the card's
 * {@link PrAutoMergeInfo} subset (AC-04). Returns undefined when the payload is
 * absent or lacks a `state`, so the row simply shows no auto-merge indicator.
 */
export function parseAutoMerge(value: unknown): PrAutoMergeInfo | undefined {
    if (!isRecord(value)) return undefined;
    const state = optionalString(value.state);
    if (state === undefined) return undefined;
    const enabledByName = isRecord(value.enabledBy) ? optionalString(value.enabledBy.displayName) : undefined;
    return {
        enabled: value.enabled === true,
        state,
        enabledBy: enabledByName ? { displayName: enabledByName } : undefined,
        mergeMethod: optionalString(value.mergeMethod),
        blockedReason: optionalString(value.blockedReason),
    };
}

/**
 * Maps a fetched PR-detail payload (the canonical `PullRequest` shape) to the
 * card's {@link PrStatusCardPr} subset. Returns undefined when the payload is not
 * a recognizable PR detail (missing title/status), so callers surface an error.
 */
export function mapPrDetailToCardPr(detail: unknown): PrStatusCardPr | undefined {
    if (!isRecord(detail)) return undefined;
    const title = optionalString(detail.title);
    const status = optionalString(detail.status);
    if (title === undefined || status === undefined) return undefined;
    return {
        number: typeof detail.number === 'number' ? detail.number : undefined,
        title,
        status,
        sourceBranch: optionalString(detail.sourceBranch) ?? '',
        targetBranch: optionalString(detail.targetBranch) ?? '',
        mergedAt: optionalString(detail.mergedAt),
        closedAt: optionalString(detail.closedAt),
        url: optionalString(detail.url),
        autoMerge: parseAutoMerge(detail.autoMerge),
    };
}

/** Sort key for newest-first ordering, read from the detail payload. */
function detailCreatedAt(detail: unknown): string | undefined {
    return isRecord(detail) ? optionalString(detail.createdAt) : undefined;
}

/** Seeds a freshly-unioned association as a loading row. */
function associationToLoadingItem(association: PrAssociation, repoId: string): PrStatusCardItem {
    return {
        key: association.key,
        repoId,
        number: association.number,
        state: 'loading',
        url: association.url,
    };
}

/** Maps the binding list response (a record keyed by prId) to the union's input shape. */
function bindingsFromResponse(bindings: Record<string, { taskId: string }> | undefined): PrChatBindingLike[] {
    if (!bindings) return [];
    return Object.entries(bindings).map(([prId, value]) => ({ prId, taskId: value.taskId }));
}

/** Optional behaviour for a detail/checks fetch. */
interface FetchOptions {
    /** Force-refresh — bypass the server cache (AC-05). */
    force?: boolean;
    /**
     * Silent (background) fetch — do not flash the loading skeleton, and on
     * failure keep the currently-displayed data instead of replacing it with an
     * error. Used by the smart poll + manual refresh so a transient failure does
     * not blank a good row.
     */
    silent?: boolean;
}

export function usePrChatStatusItems(options: UsePrChatStatusItemsOptions): UsePrChatStatusItemsResult {
    const { turns, workspaceId, remoteUrl, taskId } = options;
    const [items, setItems] = useState<PrStatusCardItem[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [lastUpdatedAt, setLastUpdatedAt] = useState<number | undefined>(undefined);

    // Bump on every (re)run / cleanup so stale async callbacks no-op.
    const generationRef = useRef(0);
    // Latest unioned associations, so `retry` can re-fetch one by key.
    const associationsRef = useRef<PrAssociation[]>([]);
    // Per-key checks fetch status — dedups expand requests (skip when loading/ready).
    const checksStatusRef = useRef<Map<string, 'loading' | 'ready' | 'error'>>(new Map());

    const chatOriginId = useMemo(
        () => (workspaceId ? resolveCanonicalOriginId({ workspaceId, remoteUrl: remoteUrl ?? null }) : ''),
        [workspaceId, remoteUrl],
    );
    const detected = useMemo(() => gatherDetectedPrsFromTurns(turns), [turns]);
    // Only re-run the fetch pipeline when the *set* of detected PRs changes,
    // not on every streaming turn update.
    const detectedKey = useMemo(() => detected.map(pr => pr.url).sort().join('|'), [detected]);

    const fetchDetailForAssociation = useCallback(
        (association: PrAssociation, repoId: string, generation: number, opts: FetchOptions = {}): Promise<void> => {
            const { force, silent } = opts;
            if (!silent) {
                setItems(prev =>
                    prev.map(item =>
                        item.key === association.key ? { ...item, state: 'loading', error: undefined } : item,
                    ),
                );
            }
            return getSpaCocClient()
                .pullRequests.getForOrigin(association.originId, association.prId, {
                    workspaceId: repoId,
                    ...(force ? { force: true } : {}),
                })
                .then(detail => {
                    if (generationRef.current !== generation) return;
                    const pr = mapPrDetailToCardPr(detail);
                    setLastUpdatedAt(Date.now());
                    setItems(prev =>
                        prev.map(item => {
                            if (item.key !== association.key) return item;
                            if (!pr) {
                                // A malformed payload on a background refresh must not blank good data.
                                if (silent && item.state === 'ready') return item;
                                return { ...item, state: 'error', error: 'Pull request details unavailable.' };
                            }
                            return {
                                ...item,
                                state: 'ready',
                                error: undefined,
                                pr,
                                number: pr.number ?? item.number,
                                createdAt: detailCreatedAt(detail),
                            };
                        }),
                    );
                })
                .catch((err: unknown) => {
                    if (generationRef.current !== generation) return;
                    setItems(prev =>
                        prev.map(item => {
                            if (item.key !== association.key) return item;
                            // A transient background-refresh failure keeps the stale row visible.
                            if (silent && item.state === 'ready') return item;
                            return { ...item, state: 'error', error: getSpaCocClientErrorMessage(err, 'Failed to load pull request.') };
                        }),
                    );
                });
        },
        [],
    );

    const fetchChecksForAssociation = useCallback(
        (association: PrAssociation, repoId: string, generation: number, opts: FetchOptions = {}) => {
            const { force, silent } = opts;
            checksStatusRef.current.set(association.key, 'loading');
            if (!silent) {
                setItems(prev =>
                    prev.map(item =>
                        item.key === association.key
                            ? { ...item, checksState: 'loading', checksError: undefined }
                            : item,
                    ),
                );
            }
            getSpaCocClient()
                .pullRequests.getChecksForOrigin(association.originId, association.prId, {
                    workspaceId: repoId,
                    ...(force ? { force: true } : {}),
                })
                .then(body => {
                    if (generationRef.current !== generation) return;
                    const rows = buildCheckRowsFromChecks((body.checks ?? []) as PullRequestCheck[]);
                    checksStatusRef.current.set(association.key, 'ready');
                    setItems(prev =>
                        prev.map(item =>
                            item.key === association.key
                                ? { ...item, checksState: 'ready', checks: rows, checksError: undefined }
                                : item,
                        ),
                    );
                })
                .catch((err: unknown) => {
                    if (generationRef.current !== generation) return;
                    // A background-refresh failure keeps the previously-loaded checks
                    // (mark 'ready' so a later toggle re-uses them); a foreground fetch
                    // surfaces the error + retry.
                    checksStatusRef.current.set(association.key, silent ? 'ready' : 'error');
                    if (silent) return;
                    setItems(prev =>
                        prev.map(item =>
                            item.key === association.key
                                ? { ...item, checksState: 'error', checksError: getSpaCocClientErrorMessage(err, 'Failed to load checks.') }
                                : item,
                        ),
                    );
                });
        },
        [],
    );

    useEffect(() => {
        // A dep change rebuilds the association set — abandon any in-flight refresh.
        setRefreshing(false);
        if (!workspaceId || !chatOriginId) {
            associationsRef.current = [];
            setItems([]);
            return;
        }
        const generation = ++generationRef.current;
        const client = getSpaCocClient();

        (async () => {
            let bindings: PrChatBindingLike[] = [];
            try {
                const response = await client.pullRequests.listChatBindingsForOrigin(
                    chatOriginId,
                    taskId ? { taskId } : undefined,
                );
                bindings = bindingsFromResponse(response.bindings);
            } catch {
                // Bindings unavailable — detected PRs still surface.
                bindings = [];
            }
            if (generationRef.current !== generation) return;

            const associations = unionAssociations({ detected, bindings, workspaceId, chatOriginId });
            associationsRef.current = associations;
            // New association set → drop stale per-key checks fetch status.
            checksStatusRef.current.clear();

            // Persist freshly-detected PRs so they survive a reload with the
            // creating turn collapsed (AC-01 DoD #2). Best-effort.
            if (taskId) {
                for (const pending of detectedPrsNeedingBinding(detected, bindings, workspaceId, chatOriginId)) {
                    client.pullRequests
                        .createChatBindingForOrigin(pending.originId, pending.prId, taskId)
                        .catch(() => {
                            /* best-effort persistence */
                        });
                }
            }

            setItems(associations.map(association => associationToLoadingItem(association, workspaceId)));
            for (const association of associations) {
                fetchDetailForAssociation(association, workspaceId, generation);
            }
        })();

        return () => {
            // Invalidate this generation on dep change / unmount.
            generationRef.current++;
        };
    }, [workspaceId, chatOriginId, taskId, detectedKey, detected, fetchDetailForAssociation]);

    const retry = useCallback(
        (key: string) => {
            if (!workspaceId) return;
            const association = associationsRef.current.find(candidate => candidate.key === key);
            if (!association) return;
            fetchDetailForAssociation(association, workspaceId, generationRef.current);
        },
        [workspaceId, fetchDetailForAssociation],
    );

    const expandChecks = useCallback(
        (key: string) => {
            if (!workspaceId) return;
            // Dedup: an in-flight or already-loaded fetch needs no refetch on toggle;
            // an 'error' (or never-fetched) key re-fetches (covers the in-panel Retry).
            const status = checksStatusRef.current.get(key);
            if (status === 'loading' || status === 'ready') return;
            const association = associationsRef.current.find(candidate => candidate.key === key);
            if (!association) return;
            fetchChecksForAssociation(association, workspaceId, generationRef.current);
        },
        [workspaceId, fetchChecksForAssociation],
    );

    /**
     * Manual refresh + smart-poll tick (AC-05): force-refresh every row's detail
     * (and any already-loaded checks panel), bypassing the server cache. Runs
     * silently so the rows don't flash a skeleton on each background poll.
     */
    const refresh = useCallback(() => {
        if (!workspaceId) return;
        const associations = associationsRef.current;
        if (associations.length === 0) return;
        const generation = generationRef.current;
        setRefreshing(true);
        const detailFetches = associations.map(association =>
            fetchDetailForAssociation(association, workspaceId, generation, { force: true, silent: true }),
        );
        for (const association of associations) {
            if (checksStatusRef.current.get(association.key) === 'ready') {
                fetchChecksForAssociation(association, workspaceId, generation, { force: true, silent: true });
            }
        }
        void Promise.allSettled(detailFetches).then(() => {
            if (generationRef.current === generation) setRefreshing(false);
        });
    }, [workspaceId, fetchDetailForAssociation, fetchChecksForAssociation]);

    // Smart auto-poll (AC-05): poll on a fixed cadence ONLY while at least one PR
    // is non-terminal and unsettled (checks pending/running or auto-merge
    // armed/queued); the interval is torn down once everything settles.
    const isPolling = useMemo(() => shouldPollPrStatusItems(items), [items]);
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;
    useEffect(() => {
        if (!isPolling) return undefined;
        const intervalId = setInterval(() => {
            refreshRef.current();
        }, PR_STATUS_POLL_INTERVAL_MS);
        return () => clearInterval(intervalId);
    }, [isPolling]);

    return { items, retry, expandChecks, refresh, refreshing, lastUpdatedAt, isPolling };
}
