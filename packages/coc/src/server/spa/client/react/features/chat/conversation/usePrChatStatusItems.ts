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
 *   5. fetches PR detail and subresources per association, mapping them to a
 *      {@link PrStatusCardItem} with per-row loading / ready / error state and a retry.
 *
 * Every REST call (binding list/upsert, detail, reviewers, checks) is routed through
 * {@link getCocClientForWorkspace} keyed by the chat's `workspaceId`, so a chat
 * owned by a REMOTE workspace resolves the PR against the server that actually
 * owns that workspace. Resolving a remote workspace id against the local server
 * would 404 (`Repo <ws> not found`). Local workspaces fall through to the default
 * page-origin client, unchanged.
 *
 * All the union / detection / origin logic lives in the pure
 * {@link ./prChatAssociation} module (unit-tested independently); this hook is the
 * thin async/React layer over it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientConversationTurn } from '../../../types/dashboard';
import { getSpaCocClientErrorMessage } from '../../../api/cocClient';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import { resolveCanonicalOriginId } from '../../../repos/originScope';
import { runWhenIdle } from '../../../utils/runWhenIdle';
import { buildCheckRowsFromChecks } from '../../pull-requests/pr-derived-data';
import type { PullRequestCheck, PullRequestDiffStats, Reviewer } from '../../pull-requests/pr-utils';
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
     * Force-refresh PR detail (and any already-loaded checks), bypassing the
     * server cache (AC-05). Pass a row `key` to refresh just that row (the
     * in-composer per-row control); call with no key to refresh every row (the
     * card-level "Refresh all" control). The smart poll refreshes silently and
     * does not go through this.
     */
    refresh: (key?: string) => void;
    /**
     * Row keys with a manual refresh in flight — drives each control's spinner.
     * A per-row refresh adds only its own key; a refresh-all adds every key.
     */
    refreshingKeys: ReadonlySet<string>;
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
 * Maps the canonical `PullRequestDiffStats` payload to the card's subset (used by
 * the in-composer chip's `+adds / −dels` display). Returns undefined when the
 * payload carries none of the three counts, so the chip simply omits the diff.
 */
export function parseDiffStats(value: unknown): PullRequestDiffStats | undefined {
    if (!isRecord(value)) return undefined;
    const additions = typeof value.additions === 'number' ? value.additions : undefined;
    const deletions = typeof value.deletions === 'number' ? value.deletions : undefined;
    const changedFiles = typeof value.changedFiles === 'number' ? value.changedFiles : undefined;
    if (additions === undefined && deletions === undefined && changedFiles === undefined) return undefined;
    return { additions: additions ?? 0, deletions: deletions ?? 0, changedFiles: changedFiles ?? 0 };
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
        diffStats: parseDiffStats(detail.diffStats),
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
        originId: association.originId,
        prId: association.prId,
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
    const [refreshingKeys, setRefreshingKeys] = useState<ReadonlySet<string>>(() => new Set());
    const [lastUpdatedAt, setLastUpdatedAt] = useState<number | undefined>(undefined);

    // Bump on every (re)run / cleanup so stale async callbacks no-op.
    const generationRef = useRef(0);
    // Latest unioned associations, so `retry` can re-fetch one by key.
    const associationsRef = useRef<PrAssociation[]>([]);
    // Per-key checks fetch status — dedups expand requests (skip when loading/ready).
    const checksStatusRef = useRef<Map<string, 'loading' | 'ready' | 'error'>>(new Map());
    // Per-key reviewer fetch status — dedups the eager reviewer fetch.
    const reviewersStatusRef = useRef<Map<string, 'loading' | 'ready' | 'error'>>(new Map());
    // Holds the latest fetchChecksForAssociation so the detail fetch can eager-load
    // checks on detail-ready without a declaration-order/closure cycle.
    const fetchChecksRef = useRef<
        (association: PrAssociation, repoId: string, generation: number, opts?: FetchOptions) => Promise<void>
    >(() => Promise.resolve());

    const chatOriginId = useMemo(
        () => (workspaceId ? resolveCanonicalOriginId({ workspaceId, remoteUrl: remoteUrl ?? null }) : ''),
        [workspaceId, remoteUrl],
    );
    const detected = useMemo(() => gatherDetectedPrsFromTurns(turns), [turns]);
    // Only re-run the fetch pipeline when the *set* of detected PRs changes,
    // not on every streaming turn update.
    const detectedKey = useMemo(() => detected.map(pr => pr.url).sort().join('|'), [detected]);
    // Read the latest detected PRs through a ref inside the fetch effect so
    // `detected` (a fresh array reference on every `turns` change) is NOT an
    // effect dependency. Otherwise the effect re-runs — flashing the loading
    // skeleton and refetching every row — after every tool call, even when the
    // PR set is unchanged. `detectedKey` already gates the effect on the set of
    // PR URLs actually changing.
    const detectedRef = useRef(detected);
    detectedRef.current = detected;

    const fetchReviewersForAssociation = useCallback(
        (association: PrAssociation, repoId: string, generation: number, opts: FetchOptions = {}): Promise<void> => {
            const { force, silent } = opts;
            const previousStatus = reviewersStatusRef.current.get(association.key);
            reviewersStatusRef.current.set(association.key, 'loading');
            if (!silent) {
                setItems(prev =>
                    prev.map(item =>
                        item.key === association.key
                            ? { ...item, reviewersState: 'loading', reviewersError: undefined }
                            : item,
                    ),
                );
            }
            return getCocClientForWorkspace(repoId)
                .pullRequests.getReviewersForOrigin(association.originId, association.prId, {
                    workspaceId: repoId,
                    ...(force ? { force: true } : {}),
                })
                .then(body => {
                    if (generationRef.current !== generation) return;
                    const reviewers = (body.reviewers ?? []) as Reviewer[];
                    reviewersStatusRef.current.set(association.key, 'ready');
                    setItems(prev =>
                        prev.map(item =>
                            item.key === association.key
                                ? {
                                    ...item,
                                    reviewersState: 'ready',
                                    reviewers,
                                    reviewersError: undefined,
                                }
                                : item,
                        ),
                    );
                })
                .catch((err: unknown) => {
                    if (generationRef.current !== generation) return;
                    reviewersStatusRef.current.set(association.key, silent && previousStatus === 'ready' ? 'ready' : 'error');
                    if (silent) return;
                    setItems(prev =>
                        prev.map(item =>
                            item.key === association.key
                                ? {
                                    ...item,
                                    reviewersState: 'error',
                                    reviewersError: getSpaCocClientErrorMessage(err, 'Failed to load reviewers.'),
                                }
                                : item,
                        ),
                    );
                });
        },
        [],
    );

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
            return getCocClientForWorkspace(repoId)
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
                    // Eager-load the CI checks once the detail is ready so the inline
                    // summary chips appear without expanding the Checks toggle — and so
                    // the smart-poll predicate can see pending checks on a never-expanded
                    // row. Deduped via checksStatusRef (skipped once loading/ready/error).
                    if (pr && checksStatusRef.current.get(association.key) === undefined) {
                        void fetchChecksRef.current(association, repoId, generation);
                    }
                    if (pr && reviewersStatusRef.current.get(association.key) === undefined) {
                        void fetchReviewersForAssociation(association, repoId, generation);
                    }
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
        [fetchReviewersForAssociation],
    );

    const fetchChecksForAssociation = useCallback(
        (association: PrAssociation, repoId: string, generation: number, opts: FetchOptions = {}): Promise<void> => {
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
            return getCocClientForWorkspace(repoId)
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
    fetchChecksRef.current = fetchChecksForAssociation;

    useEffect(() => {
        // A dep change rebuilds the association set — abandon any in-flight refresh.
        setRefreshingKeys(new Set());
        if (!workspaceId || !chatOriginId) {
            associationsRef.current = [];
            setItems([]);
            return;
        }
        const generation = ++generationRef.current;
        const client = getCocClientForWorkspace(workspaceId);

        // The bindings round-trip is non-critical chrome (the PR status card),
        // not the message-render path: defer it to browser idle so the
        // conversation paints first (AC-03). The synchronous reset above still
        // clears stale items immediately; the generation guard invalidates this
        // run if the deps change before idle fires.
        const cancelIdle = runWhenIdle(() => {
            if (generationRef.current !== generation) return;
            void (async () => {
            const detected = detectedRef.current;
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
            // New association set → drop stale per-key subresource fetch status.
            checksStatusRef.current.clear();
            reviewersStatusRef.current.clear();

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
        });

        return () => {
            // Invalidate this generation on dep change / unmount, and drop the
            // deferred bindings probe if idle has not fired yet.
            generationRef.current++;
            cancelIdle();
        };
    }, [workspaceId, chatOriginId, taskId, detectedKey, fetchDetailForAssociation]);

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
     * Force-refresh the given rows' detail (and any already-loaded checks panel),
     * bypassing the server cache. Always runs silently so a row never flashes a
     * skeleton. When `spin` is set, the targeted keys are tracked in
     * {@link refreshingKeys} for the duration so only their controls show busy —
     * the smart poll passes `spin: false` so background ticks spin nothing.
     */
    const runRefresh = useCallback(
        (targets: PrAssociation[], spin: boolean) => {
            if (!workspaceId || targets.length === 0) return;
            const generation = generationRef.current;
            if (spin) {
                setRefreshingKeys(prev => {
                    const next = new Set(prev);
                    for (const association of targets) next.add(association.key);
                    return next;
                });
            }
            const refreshFetches: Promise<void>[] = targets.map(association =>
                fetchDetailForAssociation(association, workspaceId, generation, { force: true, silent: true }),
            );
            for (const association of targets) {
                refreshFetches.push(
                    fetchReviewersForAssociation(association, workspaceId, generation, { force: true, silent: true }),
                );
                if (checksStatusRef.current.get(association.key) === 'ready') {
                    refreshFetches.push(
                        fetchChecksForAssociation(association, workspaceId, generation, { force: true, silent: true }),
                    );
                }
            }
            if (spin) {
                void Promise.allSettled(refreshFetches).then(() => {
                    if (generationRef.current !== generation) return;
                    setRefreshingKeys(prev => {
                        if (targets.every(association => !prev.has(association.key))) return prev;
                        const next = new Set(prev);
                        for (const association of targets) next.delete(association.key);
                        return next;
                    });
                });
            }
        },
        [workspaceId, fetchDetailForAssociation, fetchReviewersForAssociation, fetchChecksForAssociation],
    );

    /**
     * Manual refresh (AC-05): refresh one row by `key`, or every row when called
     * with no key. Spins only the refreshed rows' controls.
     */
    const refresh = useCallback(
        (key?: string) => {
            const associations = associationsRef.current;
            const targets = key ? associations.filter(association => association.key === key) : associations;
            runRefresh(targets, true);
        },
        [runRefresh],
    );

    // Smart auto-poll (AC-05): poll on a fixed cadence ONLY while at least one PR
    // is non-terminal and unsettled (checks pending/running or auto-merge
    // armed/queued); the interval is torn down once everything settles.
    const isPolling = useMemo(() => shouldPollPrStatusItems(items), [items]);
    const runRefreshRef = useRef(runRefresh);
    runRefreshRef.current = runRefresh;
    useEffect(() => {
        if (!isPolling) return undefined;
        const intervalId = setInterval(() => {
            // Background tick: refresh every row silently, spinning nothing.
            runRefreshRef.current(associationsRef.current, false);
        }, PR_STATUS_POLL_INTERVAL_MS);
        return () => clearInterval(intervalId);
    }, [isPolling]);

    return { items, retry, expandChecks, refresh, refreshingKeys, lastUpdatedAt, isPolling };
}
