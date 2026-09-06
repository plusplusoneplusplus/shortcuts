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
import type { PrIdentity, PullRequestCheck, PullRequestDiffStats, Reviewer } from '../../pull-requests/pr-utils';
import {
    authoredJoinKeys,
    detectedPrsNeedingBinding,
    gatherDetectedPrsFromTurns,
    matchAuthoredPrs,
    unionAssociations,
    type AuthoredCommitLike,
    type PrAssociation,
    type PrChatBindingLike,
    type PrCommitLike,
    type PrDetailLike,
} from './prChatAssociation';
import { detectCommitsInToolGroup, type ToolCallLike } from './commitDetection';
import { collectToolCallsFromTurns, type ToolCallBearingTurn } from '@plusplusoneplusplus/forge/git/pull-request-detection';
import { PR_STATUS_POLL_INTERVAL_MS, shouldPollPrStatusItems } from './prStatusFreshness';
import type { PrAutoMergeInfo, PrStatusCardItem, PrStatusCardPr } from './PrStatusCard';

export interface UsePrChatStatusItemsOptions {
    /** Currently-loaded conversation turns (PRs are detected in their tool output). */
    turns: readonly ClientConversationTurn[] | undefined;
    /** Chat's owning workspace id (origin resolution + binding scope). */
    workspaceId: string | undefined;
    /**
     * Workspace remote URL — resolves the chat's canonical origin for bindings.
     * `null` = the workspace is known to have no remote (`local_` origin);
     * `undefined` = not known yet, so no origin is resolved and the hook stays
     * idle until the caller supplies one.
     */
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
 * Maps a canonical `PrIdentity` payload (the PR detail's `author`) to the card's
 * subset. Returns undefined when the payload carries no usable identity fields,
 * so the composer chip simply omits the author element (no placeholder).
 */
export function parseAuthorIdentity(value: unknown): PrIdentity | undefined {
    if (!isRecord(value)) return undefined;
    const id = value.id;
    const identity: PrIdentity = {
        id: typeof id === 'string' || typeof id === 'number' ? id : undefined,
        displayName: optionalString(value.displayName),
        email: optionalString(value.email),
        avatarUrl: optionalString(value.avatarUrl),
    };
    if (identity.id === undefined && identity.displayName === undefined && identity.email === undefined) {
        return undefined;
    }
    return identity;
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
        author: parseAuthorIdentity(detail.author),
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
        sources: association.sources,
    };
}

/** Maps the binding list response (a record keyed by prId) to the union's input shape. */
function bindingsFromResponse(bindings: Record<string, { taskId: string }> | undefined): PrChatBindingLike[] {
    if (!bindings) return [];
    return Object.entries(bindings).map(([prId, value]) => ({ prId, taskId: value.taskId }));
}

/**
 * How many candidate PRs the authored-commit scan will look at per round.
 * A chat's commits almost always land in one PR, and the scan stops at the
 * first match, so the cap only bounds the miss case.
 */
const MAX_AUTHORED_CANDIDATES = 20;

/**
 * Session cache of a PR's commit list, keyed `${originId}:${prId}`. A PR's
 * commits only change on a force-push, and several chats in the same repo scan
 * the same candidates, so one fetch per PR per session is enough. A failed
 * fetch is evicted so a later scan can retry.
 */
const prCommitsCache = new Map<string, Promise<PrCommitLike[]>>();

/** Test seam — drops the memoized PR commit lists. */
export function clearAuthoredPrCommitsCache(): void {
    prCommitsCache.clear();
}

/** Reads a PR's commit list through {@link prCommitsCache}. */
function loadPrCommits(repoId: string, originId: string, prId: string): Promise<PrCommitLike[]> {
    const cacheKey = `${originId}:${prId}`;
    const cached = prCommitsCache.get(cacheKey);
    if (cached) return cached;
    const pending = getCocClientForWorkspace(repoId)
        .pullRequests.getCommitsForOrigin(originId, prId, { workspaceId: repoId })
        .then(body => ((body.commits ?? []) as PrCommitLike[]))
        .catch((err: unknown) => {
            prCommitsCache.delete(cacheKey);
            throw err;
        });
    prCommitsCache.set(cacheKey, pending);
    return pending;
}

/** One PR to test against the chat's commits; `detail` is used when free. */
interface AuthoredCandidate {
    prId: string;
    detail?: PrDetailLike;
}

/** Reads `sourceBranch` off a loosely-typed PR list item. */
function candidateFromListItem(item: Record<string, unknown>): AuthoredCandidate | undefined {
    const number = item.number;
    const prId = typeof number === 'number' || typeof number === 'string' ? String(number) : undefined;
    if (!prId) return undefined;
    const sourceBranch = optionalString(item.sourceBranch);
    return { prId, detail: sourceBranch ? { sourceBranch } : undefined };
}

/**
 * Walks the candidates in order, testing each against the chat's commits with
 * the pure {@link matchAuthoredPrs} join, and returns the first PR that ships
 * them (or undefined). The branch fast path is free — it reads the detail the
 * caller already had — so the commit list is only fetched when it misses.
 */
async function findAuthoredPr(
    candidates: readonly AuthoredCandidate[],
    commits: readonly AuthoredCommitLike[],
    repoId: string,
    originId: string,
    isCurrent: () => boolean,
): Promise<string | undefined> {
    for (const candidate of candidates) {
        if (!isCurrent()) return undefined;
        if (candidate.detail) {
            const byBranch = matchAuthoredPrs(commits, new Map(), new Map([[candidate.prId, candidate.detail]]));
            if (byBranch.length > 0) return candidate.prId;
        }
        let prCommits: PrCommitLike[];
        try {
            prCommits = await loadPrCommits(repoId, originId, candidate.prId);
        } catch {
            continue; // A PR we cannot read simply does not match.
        }
        if (!isCurrent()) return undefined;
        const bySubject = matchAuthoredPrs(commits, new Map([[candidate.prId, prCommits]]), new Map());
        if (bySubject.length > 0) return candidate.prId;
    }
    return undefined;
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

    // `remoteUrl === undefined` means the chat's remote identity is not known yet
    // (the workspace list is still loading), NOT that the workspace has no remote.
    // Resolving an origin from it yields `local_<workspaceId>`, which reads and
    // writes bindings under an origin the chat's PRs do not live under and makes
    // `unionAssociations` drop every detected PR as "another repo's". Hold the
    // origin empty until it is known — the effect below already clears on `''`
    // and re-runs once the real origin arrives.
    const chatOriginId = useMemo(
        () => (workspaceId && remoteUrl !== undefined ? resolveCanonicalOriginId({ workspaceId, remoteUrl }) : ''),
        [workspaceId, remoteUrl],
    );
    // Scope detection to the chat's own repo: a PR URL from any other repo that
    // shows up in this chat's tool output is not this chat's PR.
    const detected = useMemo(() => gatherDetectedPrsFromTurns(turns, remoteUrl ?? null), [turns, remoteUrl]);
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

    // The commits this chat made, client-side only. They are the join key for a
    // PR that some *other* chat opened (a queued `submit-commits-as-pr` run):
    // that chat owns the binding, so this one gets nothing from the union.
    const authoredCommits = useMemo(
        () => detectCommitsInToolGroup(collectToolCallsFromTurns<ToolCallLike>(turns as readonly ToolCallBearingTurn<ToolCallLike>[] | undefined)),
        [turns],
    );
    // Same trick as `detectedKey`: only rescan when the *set* of commits changes.
    const authoredKey = useMemo(() => authoredCommits.map(commit => commit.shortHash).join('|'), [authoredCommits]);
    const authoredCommitsRef = useRef(authoredCommits);
    authoredCommitsRef.current = authoredCommits;

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

    // Authored-commit scan: surface the PR that ships this chat's commits even
    // though a different chat opened it (and owns the one binding row the PR is
    // allowed to have). Runs after the main pipeline's idle callback has seeded
    // the association set, appends rather than replaces, and never persists a
    // binding — `detectedPrsNeedingBinding` stays the only POST path.
    useEffect(() => {
        if (!workspaceId || !chatOriginId) return undefined;
        const commits = authoredCommitsRef.current;
        const { subjects, shortHashes } = authoredJoinKeys(commits);
        // No commits of our own → nothing to join against, so no I/O at all.
        if (subjects.size === 0 && shortHashes.length === 0) return undefined;

        let cancelled = false;
        // Deliberately does NOT bump `generationRef` on cleanup: that ref belongs
        // to the main pipeline and invalidating it here would cancel the detail
        // fetches this scan depends on.
        const generation = generationRef.current;
        const isCurrent = () => !cancelled && generationRef.current === generation;
        const client = getCocClientForWorkspace(workspaceId);

        const cancelIdle = runWhenIdle(() => {
            if (!isCurrent()) return;
            void (async () => {
                const alreadyAssociated = new Set(associationsRef.current.map(association => association.prId));
                const take = (candidates: AuthoredCandidate[]): AuthoredCandidate[] =>
                    candidates.filter(candidate => !alreadyAssociated.has(candidate.prId)).slice(0, MAX_AUTHORED_CANDIDATES);

                // Round 1: every PR some chat in this repo opened. Cheapest and
                // highest precision — a coc-submitted PR is always in here.
                let candidates: AuthoredCandidate[] = [];
                try {
                    const response = await client.pullRequests.listChatBindingsForOrigin(chatOriginId);
                    candidates = Object.entries(response.bindings ?? {})
                        .sort((a, b) => String(b[1]?.createdAt ?? '').localeCompare(String(a[1]?.createdAt ?? '')))
                        .map(([prId]) => ({ prId }));
                } catch {
                    candidates = [];
                }
                if (!isCurrent()) return;

                let matchedPrId = await findAuthoredPr(take(candidates), commits, workspaceId, chatOriginId, isCurrent);

                // Round 2: PRs opened outside coc have no binding to find them by.
                if (!matchedPrId && isCurrent()) {
                    let openCandidates: AuthoredCandidate[] = [];
                    try {
                        const response = await client.pullRequests.listForOrigin(chatOriginId, {
                            workspaceId,
                            status: 'open',
                            top: MAX_AUTHORED_CANDIDATES,
                        });
                        openCandidates = (response.pullRequests ?? [])
                            .map(item => candidateFromListItem(item as Record<string, unknown>))
                            .filter((candidate): candidate is AuthoredCandidate => candidate !== undefined);
                    } catch {
                        openCandidates = [];
                    }
                    if (!isCurrent()) return;
                    matchedPrId = await findAuthoredPr(take(openCandidates), commits, workspaceId, chatOriginId, isCurrent);
                }

                if (!matchedPrId || !isCurrent()) return;
                const key = `${chatOriginId}:${matchedPrId}`;
                if (associationsRef.current.some(association => association.key === key)) return;
                const parsed = Number.parseInt(matchedPrId, 10);
                const association: PrAssociation = {
                    key,
                    originId: chatOriginId,
                    prId: matchedPrId,
                    number: Number.isNaN(parsed) ? 0 : parsed,
                    sources: ['authored'],
                };
                associationsRef.current = [...associationsRef.current, association];
                setItems(prev =>
                    prev.some(item => item.key === key)
                        ? prev
                        : [...prev, associationToLoadingItem(association, workspaceId)],
                );
                fetchDetailForAssociation(association, workspaceId, generation);
            })();
        });

        return () => {
            cancelled = true;
            cancelIdle();
        };
        // `authoredKey` gates on the commit set; the rest mirror the main effect
        // so this rescans whenever that pipeline rebuilds its associations.
    }, [workspaceId, chatOriginId, taskId, detectedKey, authoredKey, fetchDetailForAssociation]);

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
