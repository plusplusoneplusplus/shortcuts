/**
 * PullRequestsTab — fetches and renders the redesigned "PR review
 * command queue" left rail plus the PR detail / batch panel right pane.
 *
 * The queue is grouped into two sections (Needs review / Ready after
 * checks) and filtered via four pills (All / Mine / Blocked / Ready).
 * Real PR data still drives the list; AI-flagged risk, file count, and
 * review minutes shown on each row come from the deterministic
 * `pr-mock-data` module.
 *
 * Desktop: resizable split-panel (queue left, detail right).
 * Mobile: single-pane toggle (queue ↔ detail).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useApp } from '../../contexts/AppContext';
import { cn } from '../../ui';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
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
    mapAttentionToQueueSection,
    AttentionGroup,
    type QueueSection,
} from './pr-attention-groups';
import { getMockQueueRisk, type QueueFilter, type QueueFilterCounts } from './pr-mock-data';
import type { PullRequest, PrStatus } from './pr-utils';

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

/** Map a queue filter pill to the server scope it requires. */
function scopeForFilter(filter: QueueFilter): 'mine' | 'all' {
    return filter === 'all' ? 'all' : 'mine';
}

/** Filter pills that classify a PR by attention/queue section. */
function matchesFilter(pr: PullRequest, filter: QueueFilter): boolean {
    if (filter === 'all' || filter === 'mine') return true;
    const group = classifyPr(pr);
    if (filter === 'blocked') {
        return group === AttentionGroup.RerunNeeded || group === AttentionGroup.ManualUpdateNeeded;
    }
    // 'ready'
    return mapAttentionToQueueSection(group) === 'ready';
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

    const filteredBySearch = useMemo(() => {
        if (!searchText) return prs;
        const query = searchText.toLowerCase();
        return prs.filter(pr => pr.title.toLowerCase().includes(query));
    }, [prs, searchText]);

    const filteredByPill = useMemo(
        () => filteredBySearch.filter(pr => matchesFilter(pr, activeFilter)),
        [filteredBySearch, activeFilter],
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
        const counts: QueueFilterCounts = { all: 0, mine: 0, blocked: 0, ready: 0 };
        // 'all' / 'mine' counts represent the size of the currently fetched
        // scope; 'blocked' / 'ready' are derived per-PR via the classifier.
        counts.all = filteredBySearch.length;
        counts.mine = effectiveScope === 'mine' ? filteredBySearch.length : 0;
        for (const pr of filteredBySearch) {
            const group = classifyPr(pr);
            if (group === AttentionGroup.RerunNeeded || group === AttentionGroup.ManualUpdateNeeded) {
                counts.blocked += 1;
            }
            if (mapAttentionToQueueSection(group) === 'ready') {
                counts.ready += 1;
            }
        }
        return counts;
    }, [filteredBySearch, effectiveScope]);

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
                    />
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
                                        />
                                    ))}
                                </PrQueueGroupSection>
                            ))
                    )}
                    {!queueCollapsed && !loading && !error && !unconfigured && prs.length > 0 && filteredByPill.length === 0 && (
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

    // Suppress unused-warning when mock helper is only re-exported for tests.
    void getMockQueueRisk;

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
