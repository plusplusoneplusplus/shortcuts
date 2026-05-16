/**
 * PullRequestDetail — redesigned PR review command center.
 *
 * Real PR data drives the title, branches, status, reviewers, labels, and
 * comment threads. AI-flavored sections (summary, lens grid, grouped
 * threads, commit intent, checks/CI, merge readiness, file annotations,
 * and the assistant chat) are populated from deterministic fixtures in
 * `pr-mock-data.ts` for now and will swap to real data once an AI
 * backend is wired up.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Marked } from 'marked';
import { cn } from '../../ui';
import { useApp } from '../../contexts/AppContext';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { formatTimestamp, prStatusBadge } from './pr-utils';
import { ReviewerBadge } from './ReviewerBadge';
import { ThreadList } from './ThreadList';
import { PrAiSummaryPanel } from './PrAiSummaryPanel';
import { PrQuickReviewWorkflow } from './PrQuickReviewWorkflow';
import { PrConversationPanel } from './PrConversationPanel';
import { PrAiGroupedThreads } from './PrAiGroupedThreads';
import { PrCommitTable } from './PrCommitTable';
import { PrChecksTable, PrMergeReadiness } from './PrChecksAndReadiness';
import { PrFilesPanel } from './PrFilesPanel';
import { PrAiAssistantDrawer } from './PrAiAssistantDrawer';
import {
    getMockAiSummary,
    getMockBranchSnapshot,
    getMockCheckRows,
    getMockCommitRows,
    getMockFiles,
    getMockMergeReadiness,
    getMockPersonaLenses,
    getMockReviewSummaryText,
    getMockThreadGroups,
    getMockTimeline,
    riskPillClass,
} from './pr-mock-data';
import type { PullRequest, CommentThread } from './pr-utils';
import type { PrDetailTab } from '../../types/dashboard';

const descRenderer = {
    link(href: string, _title: string | null | undefined, text: string) {
        if (href && /^mailto:/i.test(href)) {
            return `<span>${text}</span>`;
        }
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
};

const descMarked = new Marked({ gfm: true, breaks: true, renderer: descRenderer });

export interface PullRequestDetailProps {
    repoId: string;
    prId: number | string;
    onBack: () => void;
    /** When true (mobile), renders the back button. Hidden on desktop. */
    isMobile?: boolean;
}

const TAB_DEFINITIONS: Array<{ id: PrDetailTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'files',    label: 'Files changed' },
    { id: 'commits',  label: 'Commits' },
    { id: 'checks',   label: 'Checks' },
];

export function PullRequestDetail({ repoId, prId, onBack, isMobile = false }: PullRequestDetailProps) {
    const { state, dispatch } = useApp();
    const [pr, setPr] = useState<PullRequest | null>(null);
    const [threads, setThreads] = useState<CommentThread[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const initialTab = (state.selectedPrDetailTab as PrDetailTab) ?? 'overview';
    const [detailTab, setDetailTab] = useState<PrDetailTab>(initialTab);
    const [assistantOpen, setAssistantOpen] = useState(false);
    const [aiPassRunning, setAiPassRunning] = useState(false);
    const [aiPassDone, setAiPassDone] = useState(false);
    const [summaryCopied, setSummaryCopied] = useState(false);

    const switchTab = useCallback(
        (tab: PrDetailTab) => {
            setDetailTab(tab);
            dispatch({ type: 'SET_PR_DETAIL_TAB', tab });
            const newHash = `#repos/${encodeURIComponent(String(repoId))}/pull-requests/${encodeURIComponent(String(prId))}/${tab}`;
            history.replaceState(null, '', newHash);
        },
        [dispatch, repoId, prId],
    );

    useEffect(() => {
        setLoading(true);
        setError(null);
        const client = getSpaCocClient();
        const prIdStr = String(prId);
        const repoIdStr = String(repoId);

        Promise.all([
            client.pullRequests
                .get(repoIdStr, prIdStr)
                .then(body => body as PullRequest),
            client.pullRequests
                .getThreads(repoIdStr, prIdStr)
                .then(body => body.threads ?? [])
                .catch(() => [] as CommentThread[]),
        ])
            .then(([prData, threadsData]) => {
                setPr(prData);
                setThreads(threadsData);
            })
            .catch(err => setError(getSpaCocClientErrorMessage(err, 'Failed to load pull request')))
            .finally(() => setLoading(false));
    }, [repoId, prId]);

    // Sync local tab state when context changes (e.g. hash navigation)
    useEffect(() => {
        if (state.selectedPrDetailTab && state.selectedPrDetailTab !== detailTab) {
            setDetailTab(state.selectedPrDetailTab as PrDetailTab);
        }
    }, [state.selectedPrDetailTab]); // eslint-disable-line react-hooks/exhaustive-deps

    const aiSummary = useMemo(() => (pr ? getMockAiSummary(pr) : null), [pr]);
    const branchSnapshot = useMemo(() => (pr ? getMockBranchSnapshot(pr) : null), [pr]);
    const personaLenses = useMemo(() => getMockPersonaLenses(), []);
    const timeline = useMemo(() => getMockTimeline(), []);
    const threadGroups = useMemo(() => getMockThreadGroups(), []);
    const commitRows = useMemo(() => getMockCommitRows(), []);
    const checkRows = useMemo(() => getMockCheckRows(), []);
    const mergeReadiness = useMemo(() => getMockMergeReadiness(), []);
    const aiFiles = useMemo(() => getMockFiles(), []);

    const handleBack = () => {
        dispatch({ type: 'CLEAR_SELECTED_PR' });
        window.location.hash = `#repos/${encodeURIComponent(String(repoId))}/pull-requests`;
        onBack();
    };

    function handleRunAiPass() {
        setAiPassRunning(true);
        setAiPassDone(false);
        window.setTimeout(() => {
            setAiPassRunning(false);
            setAiPassDone(true);
            switchTab('files');
        }, 600);
    }

    async function handleCopySummary() {
        if (!pr) return;
        const text = getMockReviewSummaryText(pr);
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            /* clipboard may not be available in tests; swallow. */
        }
        setSummaryCopied(true);
        window.setTimeout(() => setSummaryCopied(false), 1400);
    }

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
                {isMobile && (
                    <button
                        onClick={handleBack}
                        className="mb-3 text-sm text-blue-600 hover:underline dark:text-blue-400"
                        data-testid="back-button"
                    >
                        ← Back to list
                    </button>
                )}
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
    const unresolvedCount = aiSummary?.unresolvedCount ?? 0;
    const deltaText = branchSnapshot
        ? `+${branchSnapshot.additions} / -${branchSnapshot.deletions}`
        : '';

    return (
        <div className="flex h-full flex-col overflow-hidden bg-gray-50 dark:bg-gray-950" data-testid="pr-detail">
            <section className="shrink-0 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                <div className="px-6 pb-3 pt-5">
                    {isMobile && (
                        <button
                            className="mb-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
                            onClick={handleBack}
                            data-testid="back-button"
                        >
                            ← Back to list
                        </button>
                    )}

                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold shrink-0',
                                badge.className,
                            )}
                            data-testid="pr-status-badge"
                        >
                            {badge.emoji} {badge.label}
                        </span>
                        <span>
                            <strong className="font-mono text-gray-700 dark:text-gray-300">
                                {pr.author?.displayName ?? 'unknown'}
                            </strong>{' '}
                            wants to merge {branchSnapshot?.commitCount ?? 12} commits into{' '}
                            <span className="font-mono text-gray-700 dark:text-gray-300">{pr.targetBranch}</span>
                        </span>
                        {aiSummary && (
                            <span
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                                    riskPillClass(aiSummary.risk),
                                )}
                                data-testid="pr-risk-pill"
                            >
                                AI risk: {aiSummary.risk}
                            </span>
                        )}
                        {unresolvedCount > 0 && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-semibold text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200">
                                {unresolvedCount} unresolved
                            </span>
                        )}
                    </div>

                    <h1 className="m-0 max-w-[980px] text-3xl font-semibold leading-tight tracking-tight text-gray-900 dark:text-gray-100">
                        <span data-testid="pr-title">{pr.title}</span>
                        {pr.number != null && (
                            <span className="ml-2 font-normal text-gray-400 dark:text-gray-500" data-testid="pr-number">
                                #{pr.number}
                            </span>
                        )}
                    </h1>

                    <div
                        className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-gray-500 dark:text-gray-400"
                        data-testid="pr-branches"
                    >
                        <span className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                            {pr.sourceBranch}
                        </span>
                        <span>into</span>
                        <span className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                            {pr.targetBranch}
                        </span>
                        {deltaText && (
                            <span className="font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400" data-testid="pr-delta">
                                {deltaText}
                            </span>
                        )}
                        {pr.author?.displayName && (
                            <span className="ml-1">· @{pr.author.displayName}</span>
                        )}
                        {pr.createdAt && (
                            <span>· Created {formatTimestamp(pr.createdAt)}</span>
                        )}
                        {pr.updatedAt && (
                            <span>· Updated {formatTimestamp(pr.updatedAt)}</span>
                        )}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2 pb-3">
                        <button
                            type="button"
                            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-transparent bg-green-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700"
                            data-testid="pr-merge-when-ready"
                        >
                            Merge when ready
                        </button>
                        <button
                            type="button"
                            disabled={aiPassRunning}
                            onClick={handleRunAiPass}
                            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-transparent bg-gradient-to-br from-purple-500 to-blue-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-60"
                            data-testid="pr-run-ai-pass"
                        >
                            {aiPassRunning ? 'Reviewing…' : aiPassDone ? 'AI pass complete' : 'Run AI review pass'}
                        </button>
                        <button
                            type="button"
                            onClick={handleCopySummary}
                            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                            data-testid="pr-copy-summary"
                        >
                            {summaryCopied ? 'Summary copied' : 'Copy review summary'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setAssistantOpen(true)}
                            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-transparent bg-gradient-to-br from-purple-500 to-blue-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:opacity-95"
                            data-testid="pr-open-ai-assistant"
                        >
                            Ask AI
                        </button>
                        <button
                            type="button"
                            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-600 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-gray-700"
                            data-testid="pr-request-changes"
                        >
                            Request changes
                        </button>
                        {pr.url && (
                            <a
                                href={pr.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                data-testid="header-external-link"
                            >
                                Open in browser 🔗
                            </a>
                        )}
                    </div>
                </div>
                <nav className="flex gap-1 overflow-x-auto border-t border-gray-100 px-6 dark:border-gray-800" aria-label="Pull request sections">
                    {TAB_DEFINITIONS.map(tab => {
                        const isActive = detailTab === tab.id;
                        const count = tabCount(tab.id, {
                            commits: commitRows.length,
                            files: aiFiles.length,
                            checks: checkRows.length,
                            overview: threads.length,
                        });
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => switchTab(tab.id)}
                                className={cn(
                                    'inline-flex min-h-11 items-center gap-2 border-b-2 px-3 py-0 text-sm font-semibold whitespace-nowrap transition-colors',
                                    isActive
                                        ? 'border-blue-500 text-gray-900 dark:text-gray-100'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
                                )}
                                data-testid={`tab-${tab.id}`}
                            >
                                {tab.label}
                                {count !== null && (
                                    <span
                                        className={cn(
                                            'rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                                            isActive
                                                ? 'bg-blue-500 text-white'
                                                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
                                        )}
                                    >
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </nav>
            </section>

            <div className="flex-1 overflow-y-auto">
                {detailTab === 'overview' && (
                    <div className="mx-auto w-full max-w-[1180px] px-6 py-6" data-testid="overview-tab">
                        <div className="grid gap-4 lg:grid-cols-[1.35fr_minmax(300px,0.65fr)]">
                            <div className="grid gap-4">
                                {aiSummary && <PrAiSummaryPanel summary={aiSummary} />}
                                <PrQuickReviewWorkflow lenses={personaLenses} />
                                <PrConversationPanel events={timeline} />
                                <DescriptionAndMeta
                                    descHtml={descHtml}
                                    description={pr.description ?? ''}
                                    url={pr.url}
                                    reviewers={reviewers}
                                    labels={labels}
                                />
                                {threads.length > 0 && (
                                    <div
                                        className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
                                        data-testid="threads-tab"
                                    >
                                        <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800/60">
                                            <h2 className="m-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
                                                All comment threads
                                            </h2>
                                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                                {threads.length} total
                                            </span>
                                        </header>
                                        <ThreadList threads={threads} />
                                    </div>
                                )}
                            </div>
                            <div className="grid gap-4">
                                <PrAiGroupedThreads groups={threadGroups} />
                            </div>
                        </div>
                    </div>
                )}

                {detailTab === 'files' && (
                    <div className="mx-auto w-full max-w-[1180px] px-6 py-6" data-testid="files-tab">
                        <PrFilesPanel files={aiFiles} />
                    </div>
                )}

                {detailTab === 'commits' && (
                    <div className="mx-auto w-full max-w-[1180px] px-6 py-6" data-testid="commits-tab">
                        <PrCommitTable rows={commitRows} />
                    </div>
                )}

                {detailTab === 'checks' && (
                    <div className="mx-auto w-full max-w-[1180px] px-6 py-6" data-testid="checks-tab">
                        <div className="grid gap-4 lg:grid-cols-[1.35fr_minmax(300px,0.65fr)]">
                            <PrChecksTable rows={checkRows} />
                            <PrMergeReadiness items={mergeReadiness} />
                        </div>
                    </div>
                )}
            </div>

            <PrAiAssistantDrawer
                open={assistantOpen}
                onClose={() => setAssistantOpen(false)}
                prNumber={pr.number}
            />
        </div>
    );
}

function tabCount(
    tab: PrDetailTab,
    counts: { commits: number; files: number; checks: number; overview: number },
): string | number | null {
    switch (tab) {
        case 'overview': return counts.overview > 0 ? counts.overview : null;
        case 'files':    return counts.files;
        case 'commits':  return counts.commits;
        case 'checks':   return `${counts.checks}/${counts.checks}`;
    }
}

interface DescriptionAndMetaProps {
    descHtml: string;
    description: string;
    url?: string;
    reviewers: PullRequest['reviewers'];
    labels: string[];
}

function DescriptionAndMeta({ descHtml, description, url, reviewers, labels }: DescriptionAndMetaProps) {
    const reviewerList = reviewers ?? [];
    const hasMeta = reviewerList.length > 0 || labels.length > 0;

    if (!description && !hasMeta) {
        return (
            <div
                className="flex flex-col gap-2 rounded-lg border border-dashed border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
                data-testid="pr-description-empty"
            >
                <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <span aria-hidden="true">📝</span>
                    <span className="text-sm font-medium">No description</span>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                    This pull request has no description yet.
                </p>
                {url && (
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 self-start text-xs text-blue-600 hover:underline dark:text-blue-400"
                        data-testid="pr-description-open-link"
                    >
                        Open in browser to add one 🔗
                    </a>
                )}
            </div>
        );
    }

    return (
        <div
            className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-description-card"
        >
            <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800/60">
                <h2 className="m-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Description
                </h2>
                {url && (
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                        Open in browser
                    </a>
                )}
            </header>
            <div className="space-y-3 px-4 py-3.5">
                {description ? (
                    descHtml ? (
                        <div
                            className="markdown-body text-sm text-gray-700 dark:text-gray-300"
                            dangerouslySetInnerHTML={{ __html: descHtml }}
                            data-testid="pr-description"
                        />
                    ) : (
                        <pre
                            className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300"
                            data-testid="pr-description"
                        >
                            {description}
                        </pre>
                    )
                ) : (
                    <p className="text-xs italic text-gray-500 dark:text-gray-400">No description provided.</p>
                )}

                {reviewerList.length > 0 && (
                    <div data-testid="reviewers-section">
                        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            Reviewers
                        </h3>
                        <div className="space-y-1">
                            {reviewerList.map((reviewer, idx) => (
                                <ReviewerBadge key={idx} reviewer={reviewer} />
                            ))}
                        </div>
                    </div>
                )}

                {labels.length > 0 && (
                    <div data-testid="labels-section">
                        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            Labels
                        </h3>
                        <div className="flex flex-wrap gap-1">
                            {labels.map((label, idx) => (
                                <span
                                    key={idx}
                                    className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                                    data-testid="label-chip"
                                >
                                    {label}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
