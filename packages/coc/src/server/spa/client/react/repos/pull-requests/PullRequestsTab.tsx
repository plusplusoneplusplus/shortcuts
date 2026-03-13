/**
 * PullRequestsTab — fetches and renders a paginated, filterable list of pull
 * requests for the selected repository.
 *
 * Status filter triggers a server re-fetch; author and search filters are
 * applied client-side without additional requests.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getApiBase } from '../../utils/config';
import { useApp } from '../../context/AppContext';
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

export function PullRequestsTab({ repoId }: PullRequestsTabProps) {
    const { state, dispatch } = useApp();
    const [prs, setPrs] = useState<PullRequest[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [unconfigured, setUnconfigured] = useState<{ detected: string | null; remoteUrl?: string } | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
    const [authorFilter, setAuthorFilter] = useState('');
    const [searchText, setSearchText] = useState('');
    const [hasMore, setHasMore] = useState(false);

    // Track current offset without causing the callback to change on every fetch.
    const skipRef = useRef(0);

    const fetchPrs = useCallback((reset = false) => {
        const offset = reset ? 0 : skipRef.current;
        setLoading(true);
        if (reset) {
            setError(null);
            setUnconfigured(null);
            setPrs([]);
            skipRef.current = 0;
        }

        const url = `${getApiBase()}/api/repos/${encodeURIComponent(repoId)}/pull-requests?status=${statusFilter}&top=${PAGE_SIZE}&skip=${offset}`;
        fetch(url)
            .then(async res => {
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const err: any = new Error(body?.message ?? `API error: ${res.status}`);
                    err.status = res.status;
                    err.body = body;
                    throw err;
                }
                return body as { pullRequests?: PullRequest[] };
            })
            .then(data => {
                const newPrs = data.pullRequests ?? [];
                if (reset) {
                    setPrs(newPrs);
                } else {
                    setPrs(prev => [...prev, ...newPrs]);
                }
                skipRef.current = offset + newPrs.length;
                setHasMore(newPrs.length === PAGE_SIZE);
            })
            .catch(err => {
                if (err.status === 401 && err.body?.error === 'unconfigured') {
                    setUnconfigured({ detected: err.body.detected ?? null, remoteUrl: err.body.remoteUrl });
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
        const matchesAuthor = !authorFilter || pr.createdBy?.displayName?.toLowerCase().includes(authorFilter.toLowerCase());
        const matchesSearch = !searchText || pr.title.toLowerCase().includes(searchText.toLowerCase());
        return matchesAuthor && matchesSearch;
    });

    function handleRowClick(pr: PullRequest) {
        dispatch({ type: 'SET_SELECTED_PR', prId: pr.id });
        window.location.hash = `#repos/${encodeURIComponent(repoId)}/pull-requests/${pr.id}`;
    }

    return (
        <>
            {state.selectedPrId != null && (
                <PullRequestDetail
                    repoId={repoId}
                    prId={state.selectedPrId}
                    onBack={() => {}}
                />
            )}
            <div className={state.selectedPrId != null ? 'hidden' : 'flex flex-col h-full'} data-testid="pull-requests-tab">
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
            </div>

            {/* Unconfigured provider — prompts user to configure credentials */}
            {unconfigured && (
                <ProviderConfigPanel
                    detected={unconfigured.detected}
                    remoteUrl={unconfigured.remoteUrl}
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
                    <PullRequestRow key={pr.id} pr={pr} onClick={() => handleRowClick(pr)} />
                ))}
                {!loading && !error && !unconfigured && prs.length > 0 && filtered.length === 0 && (
                    <div className="px-4 py-6 text-center text-sm text-gray-500" data-testid="no-results">
                        No pull requests match your filters.
                    </div>
                )}
                {!loading && !error && !unconfigured && prs.length === 0 && (
                    <div className="px-4 py-6 text-center text-sm text-gray-500" data-testid="empty-state">
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
        </div>
        </>
    );
}
