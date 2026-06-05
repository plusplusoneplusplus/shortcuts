/**
 * PullRequestsTab — fetches and renders the redesigned "PR review
 * command queue" left rail plus the PR detail / batch panel right pane.
 *
 * The queue is grouped into two sections (Needs review / Ready after
 * checks) and filtered via pills (All / Mine / Team / Blocked / Ready,
 * plus optional For You suggestions).
 * Real PR data drives the list plus queue row file count, review minutes,
 * and deterministic risk badges.
 *
 * Desktop: resizable split-panel (queue left, detail right).
 * Mobile: single-pane toggle (queue ↔ detail).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import type { PullRequestCoworkerRosterEntry, PrSuggestion, RecentOpenedPullRequestEntry } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useApp } from '../../contexts/AppContext';
import { cn } from '../../ui';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { isPullRequestsSuggestionsEnabled } from '../../utils/config';
import { PullRequestDetail } from './PullRequestDetail';
import { PullRequestRow } from './PullRequestRow';
import { PrQueueFilters } from './PrQueueFilters';
import { PrQueueGroupSection } from './PrQueueGroupSection';

import { ProviderConfigPanel } from './ProviderConfigPanel';
import { BatchCommandPanel } from './BatchCommandPanel';
import {
    QUEUE_SECTION_CONFIGS,
    classifyPr,
    classifyQueueSection,
    type QueueSection,
} from './pr-attention-groups';
import { buildQueueFilterCounts, matchesFilter, scopeForFilter } from './pr-derived-data';
import type { QueueFilter, QueueFilterCounts } from './pr-derived-data';
import type { PullRequest, PrStatus } from './pr-utils';
import { matchWorkspaceForPrUrl, parsePrInput, type WorkspaceLike } from './pr-open-utils';

export interface PullRequestsTabProps {
    repoId: string;
    workspaceId: string;
    remoteUrl?: string;
}

const PAGE_SIZE = 25;

interface PrListCacheEntry {
    prs: PullRequest[];
    skip: number;
    hasMore: boolean;
    fetchedAt: number | null;
}

const prListCache = new Map<string, PrListCacheEntry>();

function getPrSelectionId(pr: PullRequest): string {
    return String(pr.number ?? pr.id);
}

function formatFetchedAt(ts: number, now: number = Date.now()): string {
    const diffMs = now - ts;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Updated just now';
    if (diffMin < 60) return `Updated ${diffMin} min ago`;
    return `Updated ${Math.floor(diffMin / 60)} hr ago`;
}

const STATUS_FILTER: PrStatus = 'open';
const QUEUE_COLLAPSED_KEY = 'pr-queue-collapsed';
const QUEUE_COLLAPSED_WIDTH = 44;

function loadQueueCollapsed(): boolean {
    try {
        return localStorage.getItem(QUEUE_COLLAPSED_KEY) === 'true';
    } catch {
        return false;
    }
}

function persistQueueCollapsed(value: boolean): void {
    try {
        localStorage.setItem(QUEUE_COLLAPSED_KEY, String(value));
    } catch { /* ignore */ }
}

class PullRequestOpenError extends Error {
    readonly status: number | undefined;

    constructor(message: string, status?: number) {
        super(message);
        this.name = 'PullRequestOpenError';
        this.status = status;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractRecentPrWebUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    try {
        const parsed = new URL(trimmed);
        if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password) {
            return trimmed;
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function buildRecentOpenedRecord(pr: unknown, prNumber: number): { number: number; title: string; webUrl?: string } {
    const record = isRecord(pr) ? pr : {};
    const rawTitle = record.title;
    const title = typeof rawTitle === 'string' && rawTitle.trim()
        ? rawTitle.trim()
        : `Pull request #${prNumber}`;
    const webUrl = extractRecentPrWebUrl(record.webUrl) ?? extractRecentPrWebUrl(record.url);
    return {
        number: prNumber,
        title,
        ...(webUrl ? { webUrl } : {}),
    };
}

export function PullRequestsTab({ repoId, workspaceId }: PullRequestsTabProps) {
    const { state, dispatch } = useApp();
    const [prs, setPrs] = useState<PullRequest[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [unconfigured, setUnconfigured] = useState<{ detected: string | null; remoteUrl?: string; noCredentials?: boolean } | null>(null);
    const [activeFilter, setActiveFilter] = useState<QueueFilter>('mine');
    const [searchText, setSearchText] = useState('');
    const [hasMore, setHasMore] = useState(false);
    const [fetchedAt, setFetchedAt] = useState<number | null>(null);
    const { isMobile } = useBreakpoint();
    const { width: leftPanelWidth, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: 276,
        minWidth: 200,
        maxWidth: 600,
        storageKey: 'pr-left-panel-width',
    });
    const [mobileShowDetail, setMobileShowDetail] = useState(false);
    const [selectedPrIds, setSelectedPrIds] = useState<Set<string>>(new Set());
    const [anchorPrId, setAnchorPrId] = useState<string | null>(null);
    const [batchMode, setBatchMode] = useState(false);
    const [queueCollapsed, setQueueCollapsed] = useState<boolean>(() => loadQueueCollapsed());
    const [now, setNow] = useState(() => Date.now());

    // ── Open PR by number or URL ────────────────────────────────
    const [openPrInput, setOpenPrInput] = useState('');
    const [openPrError, setOpenPrError] = useState<string | null>(null);
    const [openPrLoading, setOpenPrLoading] = useState(false);
    const [recentOpenedPrs, setRecentOpenedPrs] = useState<RecentOpenedPullRequestEntry[]>([]);
    const [coworkerRoster, setCoworkerRoster] = useState<PullRequestCoworkerRosterEntry[]>([]);

    // ── PR suggestions state ─────────────────────────────────────
    const suggestionsEnabled = isPullRequestsSuggestionsEnabled();
    const [suggestions, setSuggestions] = useState<PrSuggestion[]>([]);
    const [suggestionsLoading, setSuggestionsLoading] = useState(false);
    const [suggestionsStatus, setSuggestionsStatus] = useState<string | null>(null);
    const [suggestionsInfo, setSuggestionsInfo] = useState<string | null>(null);
    const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
    const [suggestionsRankedAt, setSuggestionsRankedAt] = useState<string | null>(null);

    const suggestedPrNumbers = useMemo(
        () => new Set(suggestions.map(s => s.prNumber)),
        [suggestions],
    );

    // Live ticker: refresh the "Updated X min ago" label every 30 s.
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(id);
    }, []);

    const toggleQueueCollapsed= useCallback(() => {
        setQueueCollapsed(prev => {
            const next = !prev;
            persistQueueCollapsed(next);
            if (next) {
                setBatchMode(false);
                setSelectedPrIds(new Set());
                setAnchorPrId(null);
            }
            return next;
        });
    }, []);

    const skipRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);

    const effectiveScope = scopeForFilter(activeFilter);

    const cacheKey = useMemo(
        () => `${repoId}|${STATUS_FILTER}|${effectiveScope}`,
        [repoId, effectiveScope],
    );

    const fetchPrs = useCallback((reset = false, force = false) => {
        if (force) {
            prListCache.delete(cacheKey);
        }

        if (reset && !force) {
            const cached = prListCache.get(cacheKey);
            if (cached) {
                setPrs(cached.prs);
                skipRef.current = cached.skip;
                setHasMore(cached.hasMore);
                setFetchedAt(cached.fetchedAt);
                setError(null);
                setUnconfigured(null);
                setLoading(false);
                return;
            }
        }

        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const offset = reset ? 0 : skipRef.current;
        setLoading(true);
        if (reset) {
            setError(null);
            setUnconfigured(null);
            setPrs([]);
            skipRef.current = 0;
        }

        getSpaCocClient().pullRequests.list(
            repoId,
            {
                status: STATUS_FILTER,
                scope: effectiveScope,
                top: PAGE_SIZE,
                skip: offset,
                force: force || undefined,
            },
            { signal: controller.signal },
        )
            .then(data => {
                const newPrs = (data.pullRequests ?? []) as PullRequest[];
                const nextSkip = offset + newPrs.length;
                const nextHasMore = newPrs.length === PAGE_SIZE;
                const ts = data.fetchedAt ?? null;

                if (reset) {
                    setPrs(newPrs);
                    prListCache.set(cacheKey, { prs: newPrs, skip: nextSkip, hasMore: nextHasMore, fetchedAt: ts });
                } else {
                    setPrs(prev => {
                        const accumulated = [...prev, ...newPrs];
                        prListCache.set(cacheKey, { prs: accumulated, skip: nextSkip, hasMore: nextHasMore, fetchedAt: ts });
                        return accumulated;
                    });
                }
                skipRef.current = nextSkip;
                setHasMore(nextHasMore);
                setFetchedAt(ts);
            })
            .catch(err => {
                if (err.name === 'AbortError') return;
                if (err instanceof CocApiError && err.status === 401) {
                    const body = err.body as Record<string, unknown> | undefined;
                    if (body?.error === 'unconfigured') {
                        setUnconfigured({ detected: (body.detected as string) ?? null, remoteUrl: body.remoteUrl as string | undefined });
                    } else if (body?.error === 'no-ado-credentials') {
                        setUnconfigured({ detected: 'ADO', noCredentials: true });
                    } else {
                        setError(err.message ?? 'Failed to load pull requests');
                    }
                } else {
                    setError(getSpaCocClientErrorMessage(err, 'Failed to load pull requests'));
                }
            })
            .finally(() => setLoading(false));
    }, [repoId, effectiveScope, cacheKey]);

    // Re-fetch from scratch whenever the active scope changes.
    useEffect(() => {
        fetchPrs(true);
    }, [fetchPrs]);

    useEffect(() => {
        let cancelled = false;
        setRecentOpenedPrs([]);
        getSpaCocClient().pullRequests.listRecentOpened(repoId, workspaceId)
            .then(data => {
                if (!cancelled) {
                    setRecentOpenedPrs(data.entries ?? []);
                }
            })
            .catch(err => {
                if (!cancelled) {
                    console.warn('Failed to load recently opened pull requests', err);
                }
            });
        return () => { cancelled = true; };
    }, [repoId, workspaceId]);

    useEffect(() => {
        let cancelled = false;
        setCoworkerRoster([]);
        getSpaCocClient().pullRequests.listCoworkerRoster(repoId, workspaceId)
            .then(data => {
                if (!cancelled) {
                    setCoworkerRoster(data.entries ?? []);
                }
            })
            .catch(err => {
                if (!cancelled) {
                    console.warn('Failed to load pull request Team roster', err);
                }
            });
        return () => { cancelled = true; };
    }, [repoId, workspaceId]);

    // Fetch cached suggestions on mount when feature is enabled.
    useEffect(() => {
        if (!suggestionsEnabled) return;
        getSpaCocClient().pullRequests.getSuggestions(repoId)
            .then(data => {
                setSuggestions(data.suggestions ?? []);
                setSuggestionsRankedAt(data.rankedAt ?? null);
            })
            .catch(() => { /* non-fatal */ });
    }, [repoId, suggestionsEnabled]);

    const handleRefreshSuggestions = useCallback(() => {
        if (suggestionsLoading) return;
        setSuggestionsLoading(true);
        setSuggestionsInfo(null);
        setSuggestionsError(null);
        setSuggestionsStatus('Fetching review history...');
        const client = getSpaCocClient().pullRequests;
        client.refreshReviewHistory(repoId)
            .then(history => {
                if ((history.reviews ?? []).length === 0) {
                    setSuggestions([]);
                    setSuggestionsRankedAt(null);
                    setSuggestionsStatus(null);
                    setSuggestionsInfo('No past reviewed PRs found yet. Suggestions need review history to learn from.');
                    return null;
                }
                setSuggestionsStatus('Ranking open PRs...');
                return client.refreshSuggestions(repoId);
            })
            .then(data => {
                if (!data) return;
                setSuggestions(data.suggestions ?? []);
                setSuggestionsRankedAt(data.rankedAt ?? null);
                setSuggestionsStatus('Updated just now');
            })
            .catch(err => {
                setSuggestionsStatus(null);
                setSuggestionsInfo(null);
                setSuggestionsError(getSpaCocClientErrorMessage(err, 'Failed to generate PR suggestions.'));
            })
            .finally(() => setSuggestionsLoading(false));
    }, [repoId, suggestionsLoading]);

    const filteredBySearch = useMemo(() => {
        if (!searchText) return prs;
        const query = searchText.toLowerCase();
        return prs.filter(pr => pr.title.toLowerCase().includes(query));
    }, [prs, searchText]);

    const filteredByPill = useMemo(
        () => filteredBySearch.filter(pr => matchesFilter(pr, activeFilter, { suggestedPrNumbers, coworkerRoster })),
        [filteredBySearch, activeFilter, suggestedPrNumbers, coworkerRoster],
    );

    const groupedPrs = useMemo(() => {
        const buckets = new Map<QueueSection, PullRequest[]>();
        for (const config of QUEUE_SECTION_CONFIGS) buckets.set(config.section, []);
        for (const pr of filteredByPill) {
            buckets.get(classifyQueueSection(pr))?.push(pr);
        }
        return QUEUE_SECTION_CONFIGS.map(config => ({
            config,
            prs: buckets.get(config.section) ?? [],
        }));
    }, [filteredByPill]);

    const filterCounts: QueueFilterCounts = useMemo(() => {
        return buildQueueFilterCounts(filteredBySearch, { effectiveScope, suggestedPrNumbers, coworkerRoster });
    }, [filteredBySearch, effectiveScope, suggestedPrNumbers, coworkerRoster]);

    const selectedPrs = useMemo(
        () => prs.filter(pr => selectedPrIds.has(getPrSelectionId(pr))),
        [prs, selectedPrIds],
    );

    const dominantGroup = useMemo(() => {
        if (selectedPrs.length === 0) return undefined;
        const tally = new Map<AttentionGroup, number>();
        for (const pr of selectedPrs) {
            const group = classifyPr(pr);
            tally.set(group, (tally.get(group) ?? 0) + 1);
        }
        let bestGroup: AttentionGroup | undefined;
        let bestCount = -1;
        for (const [group, count] of tally) {
            if (count > bestCount) {
                bestGroup = group;
                bestCount = count;
            }
        }
        return bestGroup;
    }, [selectedPrs]);

    function handleFilterChange(next: QueueFilter) {
        setActiveFilter(next);
    }

    function handleToggleBatchMode() {
        setBatchMode(prev => {
            if (prev) {
                setSelectedPrIds(new Set());
                setAnchorPrId(null);
            }
            return !prev;
        });
    }

    function handleRowClick(pr: PullRequest) {
        const prNumber = pr.number ?? pr.id;
        dispatch({ type: 'SET_SELECTED_PR', prId: prNumber });
        dispatch({ type: 'SET_PR_DETAIL_TAB', tab: 'overview' });
        window.location.hash = `#repos/${encodeURIComponent(repoId)}/pull-requests/${prNumber}/overview`;
        if (isMobile) setMobileShowDetail(true);
    }

    /** Navigate to a PR detail page after validating that the PR exists. */
    const openPrInRepo = useCallback(async (targetRepoId: string, prNumber: number): Promise<unknown> => {
        let pr: unknown;
        try {
            pr = await getSpaCocClient().pullRequests.get(targetRepoId, String(prNumber));
        } catch (err) {
            if (err instanceof CocApiError && err.status === 404) {
                throw new PullRequestOpenError(`Pull request #${prNumber} not found.`, 404);
            }
            throw new PullRequestOpenError(getSpaCocClientErrorMessage(err, `Failed to open pull request #${prNumber}.`));
        }
        dispatch({ type: 'SET_SELECTED_PR', prId: prNumber });
        dispatch({ type: 'SET_PR_DETAIL_TAB', tab: 'overview' });
        window.location.hash = `#repos/${encodeURIComponent(targetRepoId)}/pull-requests/${prNumber}/overview`;
        if (isMobile) setMobileShowDetail(true);
        return pr;
    }, [dispatch, isMobile]);

    const recordRecentOpenedPr = useCallback(async (
        targetRepoId: string,
        targetWorkspaceId: string,
        prNumber: number,
        pr: unknown,
    ) => {
        const data = await getSpaCocClient().pullRequests.recordRecentOpened(
            targetRepoId,
            targetWorkspaceId,
            buildRecentOpenedRecord(pr, prNumber),
        );
        if (targetRepoId === repoId && targetWorkspaceId === workspaceId) {
            setRecentOpenedPrs(data.entries ?? []);
        }
    }, [repoId, workspaceId]);

    const removeRecentOpenedPr = useCallback(async (entry: RecentOpenedPullRequestEntry) => {
        const data = await getSpaCocClient().pullRequests.removeRecentOpened(
            entry.repoId,
            entry.workspaceId,
            entry.number,
        );
        if (entry.repoId === repoId && entry.workspaceId === workspaceId) {
            setRecentOpenedPrs(data.entries ?? []);
        }
    }, [repoId, workspaceId]);

    const handleRecentOpenedClick = useCallback(async (entry: RecentOpenedPullRequestEntry) => {
        if (openPrLoading) return;
        setOpenPrError(null);
        setOpenPrLoading(true);
        try {
            await openPrInRepo(entry.repoId, entry.number);
        } catch (err) {
            setOpenPrError(err instanceof Error ? err.message : String(err));
            if (err instanceof PullRequestOpenError && err.status === 404) {
                try {
                    await removeRecentOpenedPr(entry);
                } catch (removeErr) {
                    console.warn('Failed to remove stale recently opened pull request', removeErr);
                }
            }
        } finally {
            setOpenPrLoading(false);
        }
    }, [openPrInRepo, openPrLoading, removeRecentOpenedPr]);

    const handleOpenPr = useCallback(async () => {
        if (openPrLoading) return;
        setOpenPrError(null);
        const parsed = parsePrInput(openPrInput);
        if (parsed.kind === 'invalid') {
            setOpenPrError(parsed.reason);
            return;
        }

        let targetRepoId: string;
        let targetWorkspaceId: string;
        let prNumber: number;
        if (parsed.kind === 'number') {
            targetRepoId = repoId;
            targetWorkspaceId = workspaceId;
            prNumber = parsed.number;
        } else {
            const ws = matchWorkspaceForPrUrl(
                (state.workspaces ?? []) as WorkspaceLike[],
                parsed,
            );
            if (!ws) {
                setOpenPrError('Repository is not registered as a workspace.');
                return;
            }
            targetRepoId = ws.id;
            targetWorkspaceId = ws.id;
            prNumber = parsed.number;
        }

        setOpenPrLoading(true);
        try {
            const pr = await openPrInRepo(targetRepoId, prNumber);
            try {
                await recordRecentOpenedPr(targetRepoId, targetWorkspaceId, prNumber, pr);
            } catch (err) {
                setOpenPrError(getSpaCocClientErrorMessage(err, 'Opened PR, but failed to update Recently opened.'));
            }
            setOpenPrInput('');
        } catch (err) {
            setOpenPrError(err instanceof Error ? err.message : String(err));
        } finally {
            setOpenPrLoading(false);
        }
    }, [openPrInput, openPrLoading, openPrInRepo, recordRecentOpenedPr, repoId, state.workspaces, workspaceId]);

    function handlePrSelect(id: string, checked: boolean, shiftKey: boolean, sectionPrs: PullRequest[]) {
        const sectionIds = sectionPrs.map(getPrSelectionId);
        const anchorIndex = anchorPrId === null ? -1 : sectionIds.indexOf(anchorPrId);
        const targetIndex = sectionIds.indexOf(id);
        const shouldSelectRange = shiftKey && anchorIndex !== -1 && targetIndex !== -1;

        setSelectedPrIds(prev => {
            const next = new Set(prev);
            if (shouldSelectRange) {
                const start = Math.min(anchorIndex, targetIndex);
                const end = Math.max(anchorIndex, targetIndex);
                for (const rangeId of sectionIds.slice(start, end + 1)) {
                    next.add(rangeId);
                }
            } else if (checked) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });

        if (!shouldSelectRange) {
            setAnchorPrId(id);
        }
    }

    const queueHeader = (
        <div
            className={cn(
                'flex shrink-0 items-center border-b border-gray-200 dark:border-gray-700',
                queueCollapsed
                    ? 'justify-center gap-0 px-1 py-1'
                    : 'gap-1.5 px-2.5 py-1',
            )}
            data-testid="pr-queue-header"
            data-collapsed={queueCollapsed}
        >
            {!queueCollapsed && (
                <span className="min-w-0 truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
                    PR queue
                </span>
            )}
            {!queueCollapsed && fetchedAt != null && !loading && (
                <span className="min-w-0 truncate text-[10px] text-gray-400 dark:text-gray-500" data-testid="fetched-at">
                    · {formatFetchedAt(fetchedAt, now)}
                </span>
            )}
            {!queueCollapsed && <span className="flex-1" />}
            <button
                type="button"
                onClick={toggleQueueCollapsed}
                aria-expanded={!queueCollapsed}
                aria-label={queueCollapsed ? 'Expand PR queue' : 'Collapse PR queue'}
                aria-controls="pr-queue-content"
                title={queueCollapsed ? 'Expand PR queue' : 'Collapse PR queue'}
                data-testid="pr-queue-toggle"
                className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-md border border-gray-300 bg-white text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
                {queueCollapsed ? '>' : '<'}
            </button>
        </div>
    );

    const queuePanel = (
        <>
            {queueHeader}
            {!queueCollapsed && (
                <div
                    className="flex shrink-0 flex-col gap-1 border-b border-gray-200 px-2.5 py-1 dark:border-gray-700"
                    data-testid="pr-open-row"
                >
                    <div className="flex items-center gap-1.5">
                        <input
                            className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                            placeholder="Open PR by # or URL"
                            value={openPrInput}
                            disabled={openPrLoading}
                            onChange={e => {
                                setOpenPrInput(e.target.value);
                                if (openPrError) setOpenPrError(null);
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void handleOpenPr();
                                }
                            }}
                            data-testid="open-pr-input"
                        />
                        <button
                            type="button"
                            onClick={() => { void handleOpenPr(); }}
                            disabled={openPrLoading || openPrInput.trim().length === 0}
                            data-testid="open-pr-button"
                            className="inline-flex h-[22px] shrink-0 items-center rounded-md border border-blue-500 bg-blue-50 px-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                        >
                            {openPrLoading ? 'Opening…' : 'Open'}
                        </button>
                    </div>
                    {openPrError && (
                        <div
                            className="text-[11px] text-red-600 dark:text-red-400"
                            data-testid="open-pr-error"
                            role="alert"
                        >
                            {openPrError}
                        </div>
                    )}
                </div>
            )}
            {!queueCollapsed && recentOpenedPrs.length > 0 && (
                <div
                    className="flex shrink-0 flex-col gap-1 border-b border-gray-200 px-2.5 py-1 dark:border-gray-700"
                    data-testid="recent-opened-prs"
                >
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Recently opened
                    </div>
                    <div className="flex flex-col gap-0.5">
                        {recentOpenedPrs.map(entry => (
                            <button
                                key={`${entry.workspaceId}:${entry.repoId}:${entry.number}`}
                                type="button"
                                onClick={() => { void handleRecentOpenedClick(entry); }}
                                disabled={openPrLoading}
                                title={`Open pull request #${entry.number}: ${entry.title}`}
                                aria-label={`Open pull request #${entry.number}: ${entry.title}`}
                                data-testid="recent-opened-pr-entry"
                                className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11px] text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-300 dark:hover:bg-gray-800"
                            >
                                <span className="shrink-0 font-semibold text-blue-600 dark:text-blue-300">
                                    #{entry.number}
                                </span>
                                <span className="min-w-0 flex-1 truncate">
                                    {entry.title}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {!queueCollapsed && (
                <div
                    className="flex shrink-0 items-center gap-1.5 border-b border-gray-200 px-2.5 py-1.5 dark:border-gray-700"
                    data-testid="pr-queue-toolbar"
                >
                    <input
                        className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        placeholder="Search PRs…"
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                        data-testid="search-input"
                    />
                    <button
                        type="button"
                        onClick={() => fetchPrs(true, true)}
                        disabled={loading}
                        title="Refresh pull requests"
                        data-testid="refresh-button"
                        className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                        <svg
                            className={loading ? 'animate-spin' : ''}
                            width="12" height="12" viewBox="0 0 24 24"
                            fill="none" stroke="currentColor" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round"
                        >
                            <path d="M21 2v6h-6" />
                            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                            <path d="M3 22v-6h6" />
                            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        onClick={handleToggleBatchMode}
                        aria-pressed={batchMode}
                        data-testid="select-mode-button"
                        className={cn(
                            'inline-flex h-[22px] shrink-0 items-center rounded-md border px-1.5 text-[11px] font-semibold transition-colors',
                            batchMode
                                ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'
                                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700',
                        )}
                    >
                        {batchMode ? 'Cancel' : 'Select'}
                    </button>
                </div>
            )}

            <div id="pr-queue-content" className="flex min-h-0 flex-1 flex-col">
                {!queueCollapsed && (
                    <PrQueueFilters
                        active={activeFilter}
                        counts={filterCounts}
                        onChange={handleFilterChange}
                        suggestionsEnabled={suggestionsEnabled}
                    />
                )}

                {!queueCollapsed && suggestionsEnabled && activeFilter === 'foryou' && (
                    <div
                        className="flex items-center justify-between gap-2 border-b border-yellow-100 bg-yellow-50 px-2.5 py-1 text-[11px] text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200"
                        data-testid="suggestions-toolbar"
                    >
                        <div className="min-w-0">
                            <span className="font-medium">AI-suggested PRs</span>
                            <span className="ml-1 text-yellow-700/80 dark:text-yellow-200/80" data-testid="suggestions-status">
                                {suggestionsLoading
                                    ? suggestionsStatus
                                    : suggestionsStatus ?? (suggestionsRankedAt ? 'Updated' : 'Generate suggestions to rank open PRs')}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={handleRefreshSuggestions}
                            disabled={suggestionsLoading}
                            className="text-xs font-semibold text-yellow-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-yellow-300"
                            data-testid="refresh-suggestions-button"
                        >
                            {suggestionsLoading ? 'Generating...' : suggestions.length > 0 ? 'Refresh' : 'Generate suggestions'}
                        </button>
                    </div>
                )}

                {!queueCollapsed && batchMode && selectedPrIds.size > 0 && (
                    <div
                        className="flex items-center justify-between border-b border-blue-100 bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
                        data-testid="selection-count-bar"
                    >
                        <span>{selectedPrIds.size} PR{selectedPrIds.size !== 1 ? 's' : ''} selected</span>
                        <button
                            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                            onClick={() => {
                                setSelectedPrIds(new Set());
                                setAnchorPrId(null);
                            }}
                            data-testid="clear-selection"
                        >
                            Clear
                        </button>
                    </div>
                )}

                {!queueCollapsed && unconfigured && (
                    <ProviderConfigPanel
                        detected={unconfigured.detected}
                        remoteUrl={unconfigured.remoteUrl}
                        noCredentials={unconfigured.noCredentials}
                        onConfigured={() => fetchPrs(true)}
                    />
                )}

                {!queueCollapsed && error && (
                    <div className="px-4 py-2 text-sm text-red-500 dark:text-red-400" data-testid="error-message">
                        {error}
                    </div>
                )}

                {!queueCollapsed && suggestionsEnabled && activeFilter === 'foryou' && suggestionsError && (
                    <div className="border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300" data-testid="suggestions-error">
                        {suggestionsError}
                    </div>
                )}

                {!queueCollapsed && suggestionsEnabled && activeFilter === 'foryou' && suggestionsInfo && (
                    <div className="border-b border-yellow-100 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200" data-testid="suggestions-info">
                        {suggestionsInfo}
                    </div>
                )}

                {!queueCollapsed && loading && prs.length === 0 && (
                    <div className="flex items-center justify-center py-8" data-testid="loading-spinner">
                        <span className="text-sm text-gray-500">Loading pull requests…</span>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto" data-testid="pr-list">
                    {!error && !unconfigured && !(loading && prs.length === 0) && filteredByPill.length > 0 && (
                        groupedPrs
                            .filter(({ prs: sectionPrs }) => sectionPrs.length > 0)
                            .map(({ config, prs: sectionPrs }) => (
                                <PrQueueGroupSection
                                    key={config.section}
                                    section={config.section}
                                    label={config.label}
                                    compact={queueCollapsed}
                                >
                                    {sectionPrs.map(pr => (
                                        <PullRequestRow
                                            key={pr.id}
                                            pr={pr}
                                            onClick={() => handleRowClick(pr)}
                                            isSelected={state.selectedPrId != null && String(pr.number ?? pr.id) === String(state.selectedPrId)}
                                            isChecked={selectedPrIds.has(getPrSelectionId(pr))}
                                            onSelect={(id, checked, shiftKey) =>
                                                handlePrSelect(id, checked, shiftKey, sectionPrs)
                                            }
                                            batchMode={batchMode && !queueCollapsed}
                                            compact={queueCollapsed}
                                            isSuggested={suggestionsEnabled && suggestedPrNumbers.has(pr.number ?? 0)}
                                        />
                                    ))}
                                </PrQueueGroupSection>
                            ))
                    )}
                    {!queueCollapsed && !loading && !error && !unconfigured && suggestionsEnabled && activeFilter === 'foryou' && prs.length > 0 && filteredByPill.length === 0 && suggestions.length === 0 && (
                        <div className="m-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-100" data-testid="suggestions-empty-state">
                            <div className="font-semibold">Find PRs for you</div>
                            <div className="mt-1 text-xs text-yellow-800 dark:text-yellow-200">
                                CoC can suggest open PRs based on your past review history.
                            </div>
                            <button
                                type="button"
                                onClick={handleRefreshSuggestions}
                                disabled={suggestionsLoading}
                                className="mt-2 rounded-md border border-yellow-300 bg-white px-2 py-1 text-xs font-semibold text-yellow-800 hover:bg-yellow-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-100 dark:hover:bg-yellow-900/40"
                                data-testid="generate-suggestions-empty-button"
                            >
                                {suggestionsLoading ? 'Generating...' : 'Generate suggestions'}
                            </button>
                        </div>
                    )}
                    {!queueCollapsed && !loading && !error && !unconfigured && !(suggestionsEnabled && activeFilter === 'foryou' && suggestions.length === 0) && prs.length > 0 && filteredByPill.length === 0 && (
                        <div className="px-4 py-6 text-center text-sm text-gray-500" data-testid="no-results">
                            No pull requests match your filters.
                        </div>
                    )}
                    {!queueCollapsed && !loading && !error && !unconfigured && prs.length === 0 && (
                        <div className="pr-empty-state px-4 py-6 text-center text-sm text-gray-500" data-testid="empty-state">
                            No pull requests found.
                        </div>
                    )}
                </div>

                {!queueCollapsed && hasMore && !loading && (
                    <div className="border-t border-gray-200 px-2.5 py-1.5 dark:border-gray-700">
                        <button
                            className="w-full py-0.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
                            onClick={() => fetchPrs(false)}
                            data-testid="load-more"
                        >
                            Load more
                        </button>
                    </div>
                )}

                {!queueCollapsed && loading && prs.length > 0 && (
                    <div className="px-2.5 py-1.5 text-center text-xs text-gray-500" data-testid="loading-more">
                        Loading…
                    </div>
                )}


            </div>
        </>
    );

    const detailContent = batchMode && selectedPrIds.size > 0 ? (
        <BatchCommandPanel
            selectedPrIds={selectedPrIds}
            selectedPrs={selectedPrs}
            repoId={repoId}
            workspaceId={workspaceId}
            activeGroup={dominantGroup}
            onClearSelection={() => {
                setSelectedPrIds(new Set());
                setAnchorPrId(null);
            }}
        />
    ) : state.selectedPrId != null ? (
        <PullRequestDetail
            repoId={repoId}
            prId={state.selectedPrId}
            onBack={() => { if (isMobile) setMobileShowDetail(false); }}
            isMobile={isMobile}
        />
    ) : (
        <div
            className="flex items-center justify-center h-full text-sm text-gray-500"
            data-testid="pr-empty-state"
        >
            Select a pull request
        </div>
    );

    if (isMobile) {
        return (
            <div className="flex flex-col h-full overflow-hidden" data-testid="pr-split-panel">
                {mobileShowDetail ? (
                    <div className="flex-1 flex flex-col overflow-hidden" data-testid="pr-detail-panel">
                        {detailContent}
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-900" data-testid="pr-list-panel">
                        {queuePanel}
                    </div>
                )}
            </div>
        );
    }

    const effectiveLeftPanelWidth = queueCollapsed ? QUEUE_COLLAPSED_WIDTH : leftPanelWidth;

    return (
        <div className={cn('flex h-full overflow-hidden', isDragging && 'select-none')} data-testid="pr-split-panel">
            <div
                className="flex-shrink-0 border-r border-gray-200 flex flex-col overflow-hidden bg-white dark:border-gray-700 dark:bg-gray-900"
                style={{ width: effectiveLeftPanelWidth }}
                data-testid="pr-list-panel"
                data-collapsed={queueCollapsed}
            >
                {queuePanel}
            </div>

            {!queueCollapsed && (
                <div
                    className="flex items-center justify-center w-1 cursor-col-resize hover:bg-blue-400/30 active:bg-blue-400/50 transition-colors flex-shrink-0"
                    onMouseDown={handleMouseDown}
                    onTouchStart={handleTouchStart}
                    data-testid="pr-resize-handle"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize pull requests panel"
                    tabIndex={0}
                />
            )}

            <div className="flex-1 min-w-0 overflow-y-auto" data-testid="pr-detail-panel">
                {detailContent}
            </div>
        </div>
    );
}
