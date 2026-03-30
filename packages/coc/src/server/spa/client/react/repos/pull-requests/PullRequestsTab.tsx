/**
 * PullRequestsTab — fetches and renders a paginated, filterable list of pull
 * requests for the selected repository.
 *
 * Status filter triggers a server re-fetch; author and search filters are
 * applied client-side without additional requests.
 *
 * Desktop: resizable split-panel (list left, detail right).
 * Mobile: single-pane toggle (list ↔ detail).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getApiBase } from '../../utils/config';
import { useApp } from '../../context/AppContext';
import { cn } from '../../shared';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { PullRequestRow } from './PullRequestRow';
import { PullRequestDetail } from './PullRequestDetail';
import type { PullRequest, PrStatus } from './pr-utils';
import { ProviderConfigPanel } from './ProviderConfigPanel';

export interface PullRequestsTabProps {
    repoId: string;
    workspaceId: string;
    remoteUrl?: string;
}

type StatusFilter = PrStatus | 'all';

const PAGE_SIZE = 25;

interface PrListCacheEntry {
    prs: PullRequest[];
    skip: number;
    hasMore: boolean;
    fetchedAt: number | null;
}

/** Keyed by `${repoId}|${statusFilter}` — persists across mounts. */
const prListCache = new Map<string, PrListCacheEntry>();

function formatFetchedAt(ts: number): string {
    const diffMs = Date.now() - ts;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Updated just now';
    if (diffMin < 60) return `Updated ${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    return `Updated ${diffHr} hr ago`;
}

export function PullRequestsTab({ repoId }: PullRequestsTabProps) {
    const { state, dispatch } = useApp();
    const [prs, setPrs] = useState<PullRequest[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [unconfigured, setUnconfigured] = useState<{ detected: string | null; remoteUrl?: string; noCredentials?: boolean } | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
    const [authorFilter, setAuthorFilter] = useState('');
    const [searchText, setSearchText] = useState('');
    const [hasMore, setHasMore] = useState(false);
    const [fetchedAt, setFetchedAt] = useState<number | null>(null);
    const { isMobile } = useBreakpoint();
    const { width: leftPanelWidth, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: 288,
        minWidth: 160,
        maxWidth: 600,
        storageKey: 'pr-left-panel-width',
    });
    const [mobileShowDetail, setMobileShowDetail] = useState(false);

    // Track current offset without causing the callback to change on every fetch.
    const skipRef = useRef(0);

    const fetchPrs = useCallback((reset = false, force = false) => {
        const cacheKey = `${repoId}|${statusFilter}`;

        if (force) {
            prListCache.delete(cacheKey);
        }

        // Cache hit: restore state and skip the network request
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

        const offset = reset ? 0 : skipRef.current;
        setLoading(true);
        if (reset) {
            setError(null);
            setUnconfigured(null);
            setPrs([]);
            skipRef.current = 0;
        }

        const url = `${getApiBase()}/repos/${encodeURIComponent(repoId)}/pull-requests?status=${statusFilter}&top=${PAGE_SIZE}&skip=${offset}${force ? '&force=true' : ''}`;
        fetch(url)
            .then(async res => {
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const err: any = new Error(body?.message ?? `API error: ${res.status}`);
                    err.status = res.status;
                    err.body = body;
                    throw err;
                }
                return body as { pullRequests?: PullRequest[]; fetchedAt?: number };
            })
            .then(data => {
                const newPrs = data.pullRequests ?? [];
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
                if (err.status === 401 && err.body?.error === 'unconfigured') {
                    setUnconfigured({ detected: err.body.detected ?? null, remoteUrl: err.body.remoteUrl });
                } else if (err.status === 401 && err.body?.error === 'no-ado-credentials') {
                    setUnconfigured({ detected: 'ADO', noCredentials: true });
                } else {
                    setError(err.message ?? 'Failed to load pull requests');
                }
            })
            .finally(() => setLoading(false));
    }, [repoId, statusFilter]); // intentionally excludes skipRef (stable ref)

    // Re-fetch from scratch whenever repoId or statusFilter changes.
    useEffect(() => {
        fetchPrs(true);
    }, [fetchPrs]);

    const filtered = prs.filter(pr => {
        const matchesAuthor = !authorFilter || pr.author?.displayName?.toLowerCase().includes(authorFilter.toLowerCase());
        const matchesSearch = !searchText || pr.title.toLowerCase().includes(searchText.toLowerCase());
        return matchesAuthor && matchesSearch;
    });

    function handleRowClick(pr: PullRequest) {
        // Use pr.number (sequential PR number) not pr.id (GitHub internal DB ID).
        // GitHub's REST API requires pull_number, not the database id.
        const prNumber = pr.number ?? pr.id;
        dispatch({ type: 'SET_SELECTED_PR', prId: prNumber });
        window.location.hash = `#repos/${encodeURIComponent(repoId)}/pull-requests/${prNumber}`;
        if (isMobile) setMobileShowDetail(true);
    }

    const listPanel = (
        <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0 flex-wrap">
                <input
                    className="flex-1 min-w-32 text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800"
                    placeholder="Search PRs..."
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                    data-testid="search-input"
                />
                <select
                    className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800"
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                    data-testid="status-filter"
                >
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                    <option value="merged">Merged</option>
                    <option value="draft">Draft</option>
                    <option value="all">All</option>
                </select>
                <input
                    className="w-32 text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800"
                    placeholder="Author..."
                    value={authorFilter}
                    onChange={e => setAuthorFilter(e.target.value)}
                    data-testid="author-filter"
                />
                {fetchedAt != null && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap" data-testid="fetched-at">
                        {formatFetchedAt(fetchedAt)}
                    </span>
                )}
                <button
                    onClick={() => fetchPrs(true, true)}
                    disabled={loading}
                    title="Refresh pull requests"
                    data-testid="refresh-button"
                    className="flex items-center gap-1 text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <svg
                        className={loading ? 'animate-spin' : ''}
                        width="14" height="14" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round"
                    >
                        <path d="M21 2v6h-6" />
                        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                        <path d="M3 22v-6h6" />
                        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                    </svg>
                </button>
            </div>

            {/* Unconfigured provider — prompts user to configure credentials */}
            {unconfigured && (
                <ProviderConfigPanel
                    detected={unconfigured.detected}
                    remoteUrl={unconfigured.remoteUrl}
                    noCredentials={unconfigured.noCredentials}
                    onConfigured={() => fetchPrs(true)}
                />
            )}

            {/* Error state */}
            {error && (
                <div className="px-4 py-2 text-sm text-red-500 dark:text-red-400" data-testid="error-message">
                    {error}
                </div>
            )}

            {/* Initial loading state */}
            {loading && prs.length === 0 && (
                <div className="flex items-center justify-center py-8" data-testid="loading-spinner">
                    <span className="text-sm text-gray-500">Loading pull requests…</span>
                </div>
            )}

            {/* PR list */}
            <div className="flex-1 overflow-y-auto" data-testid="pr-list">
                {filtered.map(pr => (
                    <PullRequestRow key={pr.id} pr={pr} onClick={() => handleRowClick(pr)} isSelected={(pr.number ?? pr.id) === state.selectedPrId} />
                ))}
                {!loading && !error && !unconfigured && prs.length > 0 && filtered.length === 0 && (
                    <div className="px-4 py-6 text-center text-sm text-gray-500" data-testid="no-results">
                        No pull requests match your filters.
                    </div>
                )}
                {!loading && !error && !unconfigured && prs.length === 0 && (
                    <div className="pr-empty-state px-4 py-6 text-center text-sm text-gray-500" data-testid="empty-state">
                        No pull requests found.
                    </div>
                )}
            </div>

            {/* Load more */}
            {hasMore && !loading && (
                <div className="px-4 py-2 shrink-0 border-t border-gray-200 dark:border-gray-700">
                    <button
                        className="w-full text-sm text-blue-600 dark:text-blue-400 hover:underline py-1"
                        onClick={() => fetchPrs(false)}
                        data-testid="load-more"
                    >
                        Load more
                    </button>
                </div>
            )}

            {/* Loading more indicator */}
            {loading && prs.length > 0 && (
                <div className="px-4 py-2 text-center text-sm text-gray-500 shrink-0" data-testid="loading-more">
                    Loading…
                </div>
            )}
        </>
    );

    const detailContent = state.selectedPrId != null ? (
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
                    <div className="flex-1 flex flex-col overflow-hidden" data-testid="pr-list-panel">
                        {listPanel}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={cn('flex h-full overflow-hidden', isDragging && 'select-none')} data-testid="pr-split-panel">
            {/* Left panel */}
            <div
                className="flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
                style={{ width: leftPanelWidth }}
                data-testid="pr-list-panel"
            >
                {listPanel}
            </div>

            {/* Resize handle */}
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

            {/* Right panel */}
            <div className="flex-1 min-w-0 overflow-y-auto" data-testid="pr-detail-panel">
                {detailContent}
            </div>
        </div>
    );
}
