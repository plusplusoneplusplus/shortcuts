/**
 * PullRequestDetail — renders a single PR's overview (description, reviewers, labels)
 * and comment threads in a two-tab layout.
 */

import { useState, useEffect } from 'react';
import { Marked } from 'marked';
import { useApp } from '../../context/AppContext';
import { getApiBase } from '../../utils/config';
import { prStatusBadge, formatRelativeTime } from './pr-utils';
import { ReviewerBadge } from './ReviewerBadge';
import { ThreadList } from './ThreadList';
import type { PullRequest, CommentThread } from './pr-utils';

const descMarked = new Marked({ gfm: true, breaks: true });

export interface PullRequestDetailProps {
    repoId: string;
    prId: number | string;
    onBack: () => void;
}

export function PullRequestDetail({ repoId, prId, onBack }: PullRequestDetailProps) {
    const { dispatch } = useApp();
    const [pr, setPr] = useState<PullRequest | null>(null);
    const [threads, setThreads] = useState<CommentThread[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detailTab, setDetailTab] = useState<'overview' | 'threads'>('overview');

    useEffect(() => {
        setLoading(true);
        setError(null);
        const base = getApiBase();
        const repoEnc = encodeURIComponent(String(repoId));
        const prEnc = encodeURIComponent(String(prId));
        const prUrl = `${base}/repos/${repoEnc}/pull-requests/${prEnc}`;
        const threadsUrl = `${base}/repos/${repoEnc}/pull-requests/${prEnc}/threads`;

        Promise.all([
            fetch(prUrl).then(async r => {
                const body = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(body?.message ?? `API error: ${r.status}`);
                return body as PullRequest;
            }),
            fetch(threadsUrl).then(async r => {
                const body = await r.json().catch(() => ({ threads: [] }));
                if (!r.ok) return { threads: [] as CommentThread[] };
                return body as { threads: CommentThread[] };
            }),
        ])
            .then(([prData, threadsData]) => {
                setPr(prData);
                setThreads(threadsData.threads ?? []);
            })
            .catch(err => setError(err.message ?? 'Failed to load pull request'))
            .finally(() => setLoading(false));
    }, [repoId, prId]);

    const handleBack = () => {
        dispatch({ type: 'CLEAR_SELECTED_PR' });
        window.location.hash = `#repos/${encodeURIComponent(String(repoId))}/pull-requests`;
        onBack();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8" data-testid="loading-spinner">
                <span className="text-sm text-gray-500">Loading pull request…</span>
            </div>
        );
    }

    if (error || !pr) {
        return (
            <div className="px-4 py-4" data-testid="error-container">
                <button
                    onClick={handleBack}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-3"
                    data-testid="back-button"
                >
                    ← Back to list
                </button>
                <p className="text-sm text-red-500" data-testid="error-message">
                    {error ?? 'Pull request not found.'}
                </p>
            </div>
        );
    }

    const badge = prStatusBadge(pr.status);
    const reviewers = pr.reviewers ?? [];
    const labels = pr.labels ?? [];
    const descHtml = pr.description ? String(descMarked.parse(pr.description)) : '';

    return (
        <div className="flex flex-col h-full overflow-hidden" data-testid="pr-detail">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
                <button
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2"
                    onClick={handleBack}
                    data-testid="back-button"
                >
                    ← Back to list
                </button>

                <div className="flex items-start gap-2 flex-wrap">
                    {pr.number != null && (
                        <span className="text-xs text-gray-400 mt-1">#{pr.number}</span>
                    )}
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex-1" data-testid="pr-title">
                        {pr.title}
                    </h2>
                    <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${badge.className}`}
                        data-testid="pr-status-badge"
                    >
                        {badge.emoji} {badge.label}
                    </span>
                </div>

                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1" data-testid="pr-branches">
                    <strong>{pr.targetBranch}</strong>
                    <span className="mx-1">←</span>
                    <strong>{pr.sourceBranch}</strong>
                </div>

                <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    {pr.createdBy?.displayName && <span>@{pr.createdBy.displayName}</span>}
                    <span>· Created {formatRelativeTime(pr.createdAt)}</span>
                    <span>· Updated {formatRelativeTime(pr.updatedAt)}</span>
                    {pr.url && (
                        <a
                            href={pr.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 dark:text-blue-400 hover:underline"
                            data-testid="header-external-link"
                        >
                            🔗
                        </a>
                    )}
                </div>

                {/* Sub-tabs */}
                <div className="flex gap-1 mt-3">
                    <button
                        className={`px-3 py-1 text-sm rounded-t border-b-2 transition-colors ${
                            detailTab === 'overview'
                                ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-medium'
                                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                        onClick={() => setDetailTab('overview')}
                        data-testid="tab-overview"
                    >
                        Overview
                    </button>
                    <button
                        className={`px-3 py-1 text-sm rounded-t border-b-2 transition-colors ${
                            detailTab === 'threads'
                                ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-medium'
                                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                        onClick={() => setDetailTab('threads')}
                        data-testid="tab-threads"
                    >
                        Threads ({threads.length})
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
                {detailTab === 'overview' && (
                    <div className="px-4 py-4 space-y-4" data-testid="overview-tab">
                        {/* Description */}
                        {pr.description ? (
                            descHtml ? (
                                <div
                                    className="markdown-body text-sm text-gray-700 dark:text-gray-300"
                                    dangerouslySetInnerHTML={{ __html: descHtml }}
                                    data-testid="pr-description"
                                />
                            ) : (
                                <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap" data-testid="pr-description">
                                    {pr.description}
                                </pre>
                            )
                        ) : (
                            <p className="text-sm text-gray-400 italic" data-testid="pr-description-empty">
                                No description provided.
                            </p>
                        )}

                        {/* Reviewers */}
                        {reviewers.length > 0 && (
                            <div data-testid="reviewers-section">
                                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                    Reviewers
                                </h3>
                                <div className="space-y-1">
                                    {reviewers.map((r, i) => (
                                        <ReviewerBadge key={i} reviewer={r} />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Labels */}
                        {labels.length > 0 && (
                            <div data-testid="labels-section">
                                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                    Labels
                                </h3>
                                <div className="flex flex-wrap gap-1">
                                    {labels.map((label, i) => (
                                        <span
                                            key={i}
                                            className="bg-gray-100 text-gray-700 rounded px-1 text-xs dark:bg-gray-700 dark:text-gray-300"
                                            data-testid="label-chip"
                                        >
                                            {label}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* External link */}
                        {pr.url && (
                            <div>
                                <a
                                    href={pr.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                                    data-testid="overview-external-link"
                                >
                                    Open in browser 🔗
                                </a>
                            </div>
                        )}
                    </div>
                )}

                {detailTab === 'threads' && (
                    <div data-testid="threads-tab">
                        <ThreadList threads={threads} />
                    </div>
                )}
            </div>
        </div>
    );
}
