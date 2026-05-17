/**
 * PullRequestDetail — redesigned PR review command center.
 *
 * Real PR data drives:
 *   - PR header (title, branches, status, reviewers, labels, description)
 *   - Comment threads (via /threads endpoint)
 *   - File list, +/- counts, hunks, and diff body (parsed from /diff)
 *   - Commit list (via /commits endpoint) — intent label is still a
 *     heuristic inferred from the commit subject (editable).
 *   - The "AI grouped threads" sidebar groups REAL threads — only the
 *     severity tag is AI-derived (deterministic, mocked for now).
 *   - Checks / CI table and merge-readiness (via /checks endpoint —
 *     provider-agnostic; works for both GitHub and ADO).
 *
 * AI-flavored sections still backed by deterministic fixtures in
 * `pr-mock-data.ts` (until an AI backend is wired up):
 *   - AI summary panel (risk, confidence, findings, metrics)
 *   - Persona lenses
 *   - Conversation timeline
 *   - Assistant chat drawer
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
    buildAiThreadGroupsFromThreads,
    buildCheckRowsFromChecks,
    buildCommitRowsFromPrCommits,
    buildMergeReadinessFromData,
    getMockAiSummary,
    getMockFiles,
    getMockPersonaLenses,
    getMockReviewSummaryText,
    getMockTimeline,
    riskPillClass,
} from './pr-mock-data';
import type { PullRequest, PullRequestCommit, CommentThread, PullRequestCheck } from './pr-utils';
import type { PrDetailTab } from '../../types/dashboard';
import { parseUnifiedDiff, type ParsedDiff } from './unified-diff-parser';

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

const EMPTY_DIFF: ParsedDiff = { files: [], totalAdditions: 0, totalDeletions: 0, fileCount: 0 };

export function PullRequestDetail({ repoId, prId, onBack, isMobile = false }: PullRequestDetailProps) {
    const { state, dispatch } = useApp();
    const [pr, setPr] = useState<PullRequest | null>(null);
    const [threads, setThreads] = useState<CommentThread[]>([]);
    const [commits, setCommits] = useState<PullRequestCommit[]>([]);
    const [commitsError, setCommitsError] = useState<string | null>(null);
    const [diff, setDiff] = useState<ParsedDiff>(EMPTY_DIFF);
    const [diffError, setDiffError] = useState<string | null>(null);
    const [checks, setChecks] = useState<PullRequestCheck[]>([]);
    const [checksError, setChecksError] = useState<string | null>(null);
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
        setDiff(EMPTY_DIFF);
        setDiffError(null);
        setCommits([]);
        setCommitsError(null);
        setChecks([]);
        setChecksError(null);
        const client = getSpaCocClient();
        const prIdStr = String(prId);
        const repoIdStr = String(repoId);

        Promise.all([
            client.pullRequests
                .get(repoIdStr, prIdStr)
                .then(body => body as PullRequest),
            client.pullRequests
                .getThreads(repoIdStr, prIdStr)
                .then(body => (body.threads ?? []) as CommentThread[])
                .catch(() => [] as CommentThread[]),
            client.pullRequests
                .getDiff(repoIdStr, prIdStr)
                .then(text => ({ kind: 'ok' as const, parsed: parseUnifiedDiff(text) }))
                .catch((err: unknown) => ({
                    kind: 'err' as const,
                    message: getSpaCocClientErrorMessage(err, 'Failed to load diff'),
                })),
            client.pullRequests
                .getCommits(repoIdStr, prIdStr)
                .then(body => ({ kind: 'ok' as const, commits: (body.commits ?? []) as PullRequestCommit[] }))
                .catch((err: unknown) => ({
                    kind: 'err' as const,
                    message: getSpaCocClientErrorMessage(err, 'Failed to load commits'),
                })),
            client.pullRequests
                .getChecks(repoIdStr, prIdStr)
                .then(body => ({ kind: 'ok' as const, checks: (body.checks ?? []) as PullRequestCheck[] }))
                .catch((err: unknown) => ({
                    kind: 'err' as const,
                    message: getSpaCocClientErrorMessage(err, 'Failed to load checks'),
                })),
        ])
            .then(([prData, threadsData, diffResult, commitsResult, checksResult]) => {
                setPr(prData);
                setThreads(threadsData);
                if (diffResult.kind === 'ok') {
                    setDiff(diffResult.parsed);
                } else {
                    setDiffError(diffResult.message);
                }
                if (commitsResult.kind === 'ok') {
                    setCommits(commitsResult.commits);
                } else {
                    setCommitsError(commitsResult.message);
                }
                if (checksResult.kind === 'ok') {
                    setChecks(checksResult.checks);
                } else {
                    setChecksError(checksResult.message);
                }
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
    const personaLenses = useMemo(() => getMockPersonaLenses(), []);
    const timeline = useMemo(() => getMockTimeline(), []);
    const threadGroups = useMemo(() => buildAiThreadGroupsFromThreads(threads), [threads]);
    const commitRows = useMemo(() => buildCommitRowsFromPrCommits(commits), [commits]);
    const checkRows = useMemo(() => buildCheckRowsFromChecks(checks), [checks]);
    const mergeReadiness = useMemo(
        () => buildMergeReadinessFromData({ checks, threads, reviewers: pr?.reviewers ?? [] }),
        [checks, threads, pr],
    );

    const threadsByPath = useMemo(() => {
        const byPath: Record<string, CommentThread[]> = {};
        for (const thread of threads) {
            const path = normalizeThreadPath(thread.threadContext?.filePath);
            if (!path) continue;
            (byPath[path] ??= []).push(thread);
        }
        return byPath;
    }, [threads]);

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
    const hasRealDiff = diff.fileCount > 0;
    const deltaText = hasRealDiff
        ? `+${diff.totalAdditions} / -${diff.totalDeletions}`
        : '';
    const fileCountText = hasRealDiff
        ? `${diff.fileCount} file${diff.fileCount === 1 ? '' : 's'}`
        : '';

    return (
        <div className="flex h-full flex-col overflow-hidden bg-gray-50 dark:bg-gray-950" data-testid="pr-detail">
            <section className="shrink-0 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                {isMobile && (
                    <button
                        className="px-2 pt-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
                        onClick={handleBack}
                        data-testid="back-button"
                    >
                        ← Back to list
                    </button>
                )}

                <div
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-[11px] text-gray-500 dark:text-gray-400"
                    data-testid="pr-hero-row"
                >
                    <span
                        className={cn(
                            'inline-flex min-h-[20px] shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                            badge.className,
                        )}
                        data-testid="pr-status-badge"
                    >
                        {badge.emoji} {badge.label}
                    </span>

                    <h1 className="m-0 inline-flex min-w-0 max-w-full items-baseline gap-1.5 truncate text-[15px] font-semibold leading-[1.2] tracking-normal text-gray-900 dark:text-gray-100">
                        <span className="truncate" data-testid="pr-title">{pr.title}</span>
                        {pr.number != null && (
                            <span className="shrink-0 font-normal text-gray-400 dark:text-gray-500" data-testid="pr-number">
                                #{pr.number}
                            </span>
                        )}
                    </h1>

                    {aiSummary && (
                        <span
                            className={cn(
                                'inline-flex min-h-[20px] shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                                riskPillClass(aiSummary.risk),
                            )}
                            data-testid="pr-risk-pill"
                        >
                            AI risk: {aiSummary.risk}
                        </span>
                    )}
                    {unresolvedCount > 0 && (
                        <span className="inline-flex min-h-[20px] shrink-0 items-center gap-1 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[11px] font-semibold text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200">
                            {unresolvedCount} unresolved
                        </span>
                    )}

                    <span className="inline-flex shrink-0 items-center gap-1" data-testid="pr-branches">
                        <strong className="font-mono text-gray-700 dark:text-gray-300">
                            {pr.author?.displayName ?? 'unknown'}
                        </strong>
                        <span>wants to merge</span>
                        <span className="rounded-[5px] border border-gray-200 bg-gray-50 px-1.5 py-px font-mono text-[11px] text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                            {pr.sourceBranch}
                        </span>
                        <span>into</span>
                        <span className="rounded-[5px] border border-gray-200 bg-gray-50 px-1.5 py-px font-mono text-[11px] text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                            {pr.targetBranch}
                        </span>
                    </span>
                    {deltaText && (
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400" data-testid="pr-delta">
                            {deltaText}
                        </span>
                    )}
                    {fileCountText && (
                        <span
                            className="shrink-0 font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400"
                            data-testid="pr-file-count"
                        >
                            {fileCountText}
                        </span>
                    )}
                    {pr.createdAt && (
                        <span className="shrink-0">· {formatTimestamp(pr.createdAt)}</span>
                    )}
                    {pr.updatedAt && pr.updatedAt !== pr.createdAt && (
                        <span className="shrink-0">· upd {formatTimestamp(pr.updatedAt)}</span>
                    )}

                    <div className="ml-auto flex shrink-0 items-center gap-px">
                        <button
                            type="button"
                            className="inline-flex min-h-[20px] items-center justify-center rounded border border-transparent bg-green-600 px-1.5 py-0 text-[11px] font-semibold leading-none text-white shadow-sm hover:bg-green-700"
                            data-testid="pr-merge-when-ready"
                        >
                            Merge
                        </button>
                        <button
                            type="button"
                            disabled={aiPassRunning}
                            onClick={handleRunAiPass}
                            className="inline-flex min-h-[20px] items-center justify-center rounded border border-transparent bg-gradient-to-br from-purple-500 to-blue-500 px-1.5 py-0 text-[11px] font-semibold leading-none text-white shadow-sm hover:opacity-95 disabled:opacity-60"
                            data-testid="pr-run-ai-pass"
                        >
                            {aiPassRunning ? 'Reviewing…' : aiPassDone ? 'AI done' : 'AI review'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setAssistantOpen(true)}
                            className="inline-flex min-h-[20px] items-center justify-center rounded border border-purple-300 bg-purple-50 px-1.5 py-0 text-[11px] font-semibold leading-none text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-200"
                            data-testid="pr-open-ai-assistant"
                        >
                            Ask AI
                        </button>
                        <button
                            type="button"
                            onClick={handleCopySummary}
                            className="inline-flex min-h-[20px] items-center justify-center rounded border border-gray-300 bg-white px-1.5 py-0 text-[11px] font-semibold leading-none text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                            data-testid="pr-copy-summary"
                        >
                            {summaryCopied ? 'Copied' : 'Copy'}
                        </button>
                        <button
                            type="button"
                            className="inline-flex min-h-[20px] items-center justify-center rounded border border-gray-300 bg-white px-1.5 py-0 text-[11px] font-semibold leading-none text-red-600 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-gray-700"
                            data-testid="pr-request-changes"
                        >
                            Changes
                        </button>
                        {pr.url && (
                            <a
                                href={pr.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-[20px] items-center justify-center rounded border border-gray-300 bg-white px-1.5 py-0 text-[11px] font-semibold leading-none text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                data-testid="header-external-link"
                            >
                                Open 🔗
                            </a>
                        )}
                    </div>
                </div>
                <nav className="flex gap-0.5 overflow-x-auto border-t border-gray-100 px-2.5 dark:border-gray-800" aria-label="Pull request sections">
                    {TAB_DEFINITIONS.map(tab => {
                        const isActive = detailTab === tab.id;
                        const passingChecks = checkRows.filter(r => r.status === 'success').length;
                        const count = tabCount(tab.id, {
                            commits: commits.length,
                            files: diff.fileCount,
                            checks: checkRows.length,
                            checksPassing: passingChecks,
                            overview: threads.length,
                        });
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => switchTab(tab.id)}
                                className={cn(
                                    'inline-flex min-h-[32px] items-center gap-1.5 border-b-2 px-2 py-0 text-[13px] font-semibold whitespace-nowrap transition-colors',
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
                                            'rounded-full px-1.5 py-px text-[11px] font-semibold leading-[1.4]',
                                            isActive
                                                ? 'bg-blue-500 text-white'
                                                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300',
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

            <div
                className={cn(
                    'flex-1 min-h-0',
                    // Files tab manages its own independent file-list /
                    // diff scrollers, so swallow the outer scroll there.
                    detailTab === 'files' ? 'overflow-hidden' : 'overflow-y-auto',
                )}
            >
                {detailTab === 'overview' && (
                    <div className="w-full px-2.5 pb-7 pt-2" data-testid="overview-tab">
                        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_264px]">
                            <div className="grid gap-2">
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
                                        className="overflow-hidden rounded-[5px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
                                        data-testid="threads-tab"
                                    >
                                        <header className="flex min-h-[30px] items-center justify-between gap-1.5 border-b border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/60">
                                            <h2 className="m-0 text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                                                All comment threads
                                            </h2>
                                            <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                                {threads.length} total
                                            </span>
                                        </header>
                                        <ThreadList threads={threads} />
                                    </div>
                                )}
                            </div>
                            <div className="grid gap-2">
                                <PrAiGroupedThreads groups={threadGroups} totalThreads={threads.length} />
                            </div>
                        </div>
                    </div>
                )}

                {detailTab === 'files' && (
                    <div
                        className="flex h-full min-h-0 w-full flex-col px-2.5 pb-2 pt-2"
                        data-testid="files-tab"
                    >
                        {diffError && (
                            <div
                                className="mb-2 shrink-0 rounded-[5px] border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200"
                                data-testid="pr-diff-error"
                            >
                                Failed to load diff: {diffError}
                            </div>
                        )}
                        <div className="min-h-0 flex-1">
                            <PrFilesPanel
                                files={diff.files}
                                commentsByPath={threadsByPath}
                            />
                        </div>
                    </div>
                )}

                {detailTab === 'commits' && (
                    <div className="w-full px-2.5 pb-7 pt-2" data-testid="commits-tab">
                        {commitsError ? (
                            <div
                                className="rounded-[5px] border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200"
                                data-testid="pr-commits-error"
                            >
                                Failed to load commits: {commitsError}
                            </div>
                        ) : commits.length === 0 ? (
                            <div
                                className="rounded-[5px] border border-dashed border-gray-200 bg-white px-2 py-3 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                                data-testid="pr-commits-empty"
                            >
                                No commits returned for this pull request.
                            </div>
                        ) : (
                            <PrCommitTable rows={commitRows} />
                        )}
                    </div>
                )}

                {detailTab === 'checks' && (
                    <div className="w-full px-2.5 pb-7 pt-2" data-testid="checks-tab">
                        {checksError && (
                            <div
                                className="mb-2 rounded-[5px] border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200"
                                data-testid="pr-checks-error"
                            >
                                Failed to load checks: {checksError}
                            </div>
                        )}
                        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_264px]">
                            <PrChecksTable rows={checkRows} />
                            <PrMergeReadiness items={mergeReadiness} />
                        </div>
                    </div>
                )}
            </div>

            <PrAiAssistantDrawer
                open={assistantOpen}
                onClose={() => setAssistantOpen(false)}
                workspaceId={String(repoId)}
                repoId={String(repoId)}
                prId={String(prId)}
                prNumber={pr.number}
                prTitle={pr.title}
            />
        </div>
    );
}

function normalizeThreadPath(filePath: string | null | undefined): string {
    return (filePath ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function tabCount(
    tab: PrDetailTab,
    counts: { commits: number; files: number; checks: number; checksPassing: number; overview: number },
): string | number | null {
    switch (tab) {
        case 'overview': return counts.overview > 0 ? counts.overview : null;
        case 'files':    return counts.files;
        case 'commits':  return counts.commits;
        case 'checks':
            return counts.checks > 0 ? `${counts.checksPassing}/${counts.checks}` : null;
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
                className="flex flex-col gap-1.5 rounded-[5px] border border-dashed border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900"
                data-testid="pr-description-empty"
            >
                <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                    <span aria-hidden="true">📝</span>
                    <span className="text-[13px] font-medium">No description</span>
                </div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                    This pull request has no description yet.
                </p>
                {url && (
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 self-start text-[11px] text-blue-600 hover:underline dark:text-blue-400"
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
            className="overflow-hidden rounded-[5px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-description-card"
        >
            <header className="flex min-h-[30px] items-center justify-between gap-1.5 border-b border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/60">
                <h2 className="m-0 text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                    Description
                </h2>
                {url && (
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                    >
                        Open in browser
                    </a>
                )}
            </header>
            <div className="space-y-2 p-2">
                {description ? (
                    descHtml ? (
                        <div
                            className="markdown-body text-[13px] leading-snug text-gray-700 dark:text-gray-300"
                            dangerouslySetInnerHTML={{ __html: descHtml }}
                            data-testid="pr-description"
                        />
                    ) : (
                        <pre
                            className="whitespace-pre-wrap text-[13px] leading-snug text-gray-700 dark:text-gray-300"
                            data-testid="pr-description"
                        >
                            {description}
                        </pre>
                    )
                ) : (
                    <p className="text-[11px] italic text-gray-500 dark:text-gray-400">No description provided.</p>
                )}

                {reviewerList.length > 0 && (
                    <div data-testid="reviewers-section">
                        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:text-gray-400">
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
                        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:text-gray-400">
                            Labels
                        </h3>
                        <div className="flex flex-wrap gap-1">
                            {labels.map((label, idx) => (
                                <span
                                    key={idx}
                                    className="rounded bg-gray-100 px-1 py-px text-[11px] text-gray-700 dark:bg-gray-700 dark:text-gray-300"
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
