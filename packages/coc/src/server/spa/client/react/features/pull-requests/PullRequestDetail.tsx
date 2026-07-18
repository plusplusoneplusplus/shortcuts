/**
 * PullRequestDetail — redesigned PR review command center.
 *
 * Real PR data drives:
 *   - PR header (title, branches, status, reviewers, labels, description)
 *   - Comment threads (via /threads endpoint)
 *   - File list, +/- counts, hunks, and diff body (parsed from /diff)
 *   - Commit list (via /commits endpoint).
 *   - Deterministic review summary facts from PR description, diff stats,
 *     checks, reviewers, and real threads.
 *   - The grouped threads sidebar buckets REAL threads with deterministic
 *     severity derived from thread status and comment text.
 *   - Checks / CI table and merge-readiness (via /checks endpoint —
 *     provider-agnostic; works for both GitHub and ADO).
 *   - Conversation timeline derived from real threads and commits.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '../../ui';
import { useApp } from '../../contexts/AppContext';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useCocClient } from '../../repos/cloneRouting';
import { formatTimestamp, prStatusBadge, autoMergeBadge } from './pr-utils';
import { ThreadList } from './ThreadList';
import { PrReviewSummaryPanel } from './PrReviewSummaryPanel';
import { PrConversationPanel } from './PrConversationPanel';
import { PrAiGroupedThreads } from './PrAiGroupedThreads';
import { PrCommitTable } from './PrCommitTable';
import { PrChecksTable, PrMergeReadiness } from './PrChecksAndReadiness';
import { PrFilesPanel } from './PrFilesPanel';
import { PrAiAssistantDrawer } from './PrAiAssistantDrawer';
import { PullRequestChatPlacementFrame } from './PullRequestChatPlacementFrame';
import { SHOW_FOCUSED_DIFF } from '../../featureFlags';
import type { ClassificationKey } from '../git/diff/diffSource';
import { buildGitPrPopOutUrl } from '../../layout/Router';
import { resolveCanonicalOriginId } from '../../repos/originScope';
import { useGitReviewPopOut, gitReviewPrPopOutKey } from '../../contexts/GitReviewPopOutContext';
import { lookupCloneBaseUrl } from '../../repos/cloneRegistry';
import { useReviewChatPresentation } from '../git/hooks/useReviewChatPresentation';
import type { ReviewChatTarget } from '../git/commits/commitChatPlacement';
import {
    buildCheckRowsFromChecks,
    buildCommitRowsFromPrCommits,
    buildMergeReadinessFromData,
    buildThreadGroupsFromThreads,
    buildTimelineFromRealData,
} from './pr-derived-data';
import {
    buildPrReviewSummary,
    buildPullRequestDiffStats,
    getPullRequestReviewSummaryText,
    reviewRiskPillClass,
} from './pr-detail-summary';
import type { PullRequest, PullRequestCommit, CommentThread, PullRequestCheck } from './pr-utils';
import { parseDiffFileList, type FileChange } from '../git/diff';
import type { PrDetailTab } from '../../types/dashboard';

export interface PullRequestDetailProps {
    repoId: string;
    workspaceId: string;
    remoteUrl?: string | null;
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

const EMPTY_FILES: FileChange[] = [];

export function PullRequestDetail({ repoId, workspaceId, remoteUrl, prId, onBack, isMobile = false }: PullRequestDetailProps) {
    const { state, dispatch } = useApp();
    const cloneClient = useCocClient(workspaceId);
    const [pr, setPr] = useState<PullRequest | null>(null);
    const [threads, setThreads] = useState<CommentThread[]>([]);
    const [commits, setCommits] = useState<PullRequestCommit[]>([]);
    const [commitsError, setCommitsError] = useState<string | null>(null);
    const [diff, setDiff] = useState<FileChange[]>(EMPTY_FILES);
    // Raw combined unified diff text — retained (alongside the parsed file
    // list) so the Files tab can slice per-file hunks for the inline diff
    // panel without a second fetch.
    const [rawDiff, setRawDiff] = useState<string>('');
    const [diffError, setDiffError] = useState<string | null>(null);
    const [checks, setChecks] = useState<PullRequestCheck[]>([]);
    const [checksError, setChecksError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const initialTab = (state.selectedPrDetailTab as PrDetailTab) ?? 'overview';
    const [detailTab, setDetailTab] = useState<PrDetailTab>(initialTab);
    const [aiPassRunning, setAiPassRunning] = useState(false);
    const [aiPassDone, setAiPassDone] = useState(false);
    const [summaryCopied, setSummaryCopied] = useState(false);

    // Pop-out context for opening PR review in a separate window
    const { markPoppedOut } = useGitReviewPopOut();
    const originId = useMemo(
        () => resolveCanonicalOriginId({ workspaceId, remoteUrl }),
        [workspaceId, remoteUrl],
    );

    // Classification hook — passes undefined key when feature flag is off or no real headSha yet.
    // Never fall back to sourceBranch: two PRs on the same branch would alias to the same key.
    const headSha = pr?.headSha;
    const classificationKey: ClassificationKey | undefined =
        SHOW_FOCUSED_DIFF && repoId && prId && headSha
            ? {
                type: 'pr',
                repoId: String(repoId),
                originId,
                workspaceId,
                identifier: `${prId}:${headSha}`,
            }
            : undefined;
    const prChatTarget = useMemo<ReviewChatTarget>(() => ({
        type: 'pr',
        workspaceId,
        repoId: String(repoId),
        prId: String(prId),
        headSha,
    }), [workspaceId, repoId, prId, headSha]);
    const {
        chatOpen: assistantOpen,
        toggleChat: toggleAssistant,
        closeChat: closeAssistant,
        minimizeChat: minimizeAssistant,
        restoreChat: restoreAssistant,
        pinChat: pinAssistant,
        unpinChat: unpinAssistant,
        isPinned: assistantPinned,
        isMinimized: assistantMinimized,
        presentation: assistantPresentation,
        lensEnabled: assistantLensEnabled,
        isDesktop: assistantIsDesktop,
    } = useReviewChatPresentation({ target: prChatTarget });
    const openAssistant = useCallback(() => {
        if (!assistantOpen) toggleAssistant();
    }, [assistantOpen, toggleAssistant]);

    // Explicit pop-out action for the Files tab. Inline (right-panel) diff is
    // now the default click path; this opens the separate review window.
    const handlePopOut = useCallback((_filePath: string) => {
        const url = buildGitPrPopOutUrl(workspaceId, String(repoId), String(prId), originId, lookupCloneBaseUrl(workspaceId));
        const win = window.open(url, `coc-git-review-pr-${prId}`, 'width=1200,height=800');
        if (win) {
            markPoppedOut(gitReviewPrPopOutKey(workspaceId, String(prId)));
        }
    }, [workspaceId, originId, repoId, prId, markPoppedOut]);

    const switchTab = useCallback(
        (tab: PrDetailTab) => {
            setDetailTab(tab);
            dispatch({ type: 'SET_PR_DETAIL_TAB', tab });
            const newHash = `#repos/${encodeURIComponent(String(repoId))}/pull-requests/${encodeURIComponent(String(prId))}/${tab}`;
            history.replaceState(null, '', newHash);
        },
        [dispatch, repoId, prId],
    );

    const fetchAll = useCallback((force = false) => {
        if (!force) setLoading(true);
        setError(null);
        setDiff(EMPTY_FILES);
        setRawDiff('');
        setDiffError(null);
        setCommits([]);
        setCommitsError(null);
        setChecks([]);
        setChecksError(null);
        const prIdStr = String(prId);
        const repoIdStr = String(repoId);
        const providerOptions = { workspaceId, repoId: repoIdStr };

        Promise.all([
            cloneClient.pullRequests
                .getForOrigin(originId, prIdStr, { ...providerOptions, force })
                .then(body => body as PullRequest),
            cloneClient.pullRequests
                .getThreadsForOrigin(originId, prIdStr, providerOptions)
                .then(body => (body.threads ?? []) as CommentThread[])
                .catch(() => [] as CommentThread[]),
            cloneClient.pullRequests
                .getDiffForOrigin(originId, prIdStr, providerOptions)
                .then(text => ({ kind: 'ok' as const, parsed: parseDiffFileList(text), raw: text }))
                .catch((err: unknown) => ({
                    kind: 'err' as const,
                    message: getSpaCocClientErrorMessage(err, 'Failed to load diff'),
                })),
            cloneClient.pullRequests
                .getCommitsForOrigin(originId, prIdStr, providerOptions)
                .then(body => ({ kind: 'ok' as const, commits: (body.commits ?? []) as PullRequestCommit[] }))
                .catch((err: unknown) => ({
                    kind: 'err' as const,
                    message: getSpaCocClientErrorMessage(err, 'Failed to load commits'),
                })),
            cloneClient.pullRequests
                .getChecksForOrigin(originId, prIdStr, providerOptions)
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
                    setRawDiff(diffResult.raw);
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
            .finally(() => {
                setLoading(false);
                setRefreshing(false);
            });
    }, [repoId, prId, originId, workspaceId, cloneClient]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const handleRefresh = useCallback(() => {
        setRefreshing(true);
        fetchAll(true);
    }, [fetchAll]);

    // Sync local tab state when context changes (e.g. hash navigation)
    useEffect(() => {
        if (state.selectedPrDetailTab && state.selectedPrDetailTab !== detailTab) {
            setDetailTab(state.selectedPrDetailTab as PrDetailTab);
        }
    }, [state.selectedPrDetailTab]); // eslint-disable-line react-hooks/exhaustive-deps

    const threadGroups = useMemo(() => buildThreadGroupsFromThreads(threads), [threads]);
    const timeline = useMemo(() => buildTimelineFromRealData(threads, commits, threadGroups), [threads, commits, threadGroups]);
    const commitRows = useMemo(() => buildCommitRowsFromPrCommits(commits), [commits]);
    const checkRows = useMemo(() => buildCheckRowsFromChecks(checks), [checks]);
    const mergeReadiness = useMemo(
        () => buildMergeReadinessFromData({ checks, threads, reviewers: pr?.reviewers ?? [] }),
        [checks, threads, pr],
    );
    const diffStats = useMemo(
        () => buildPullRequestDiffStats(diff, pr?.diffStats),
        [diff, pr?.diffStats],
    );
    const reviewSummary = useMemo(
        () => pr ? buildPrReviewSummary({
            pr,
            diffStats,
            checks,
            threads,
            reviewers: pr.reviewers ?? [],
        }) : null,
        [pr, diffStats, checks, threads],
    );


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
        const text = getPullRequestReviewSummaryText(pr);
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
    const unresolvedCount = reviewSummary?.unresolvedCount ?? 0;
    const deltaText = diffStats
        ? `+${diffStats.additions} / -${diffStats.deletions}`
        : '';
    const fileCountText = diffStats
        ? `${diffStats.changedFiles} file${diffStats.changedFiles === 1 ? '' : 's'}`
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

                    {reviewSummary && (
                        <span
                            className={cn(
                                'inline-flex min-h-[20px] shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                                reviewRiskPillClass(reviewSummary.risk),
                            )}
                            data-testid="pr-risk-pill"
                        >
                            Risk: {reviewSummary.risk}
                        </span>
                    )}
                    {pr.autoMerge?.enabled && (() => {
                        const badge = autoMergeBadge(pr.autoMerge);
                        return badge ? (
                            <span
                                className={cn(
                                    'inline-flex min-h-[20px] shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                                    badge.className,
                                )}
                                data-testid="pr-auto-merge-badge"
                            >
                                {badge.emoji} {badge.label}
                            </span>
                        ) : null;
                    })()}
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
                            onClick={openAssistant}
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
                        <button
                            type="button"
                            disabled={refreshing}
                            onClick={handleRefresh}
                            className="inline-flex min-h-[20px] items-center justify-center rounded border border-gray-300 bg-white px-1.5 py-0 text-[11px] font-semibold leading-none text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                            data-testid="pr-refresh"
                        >
                            {refreshing ? '↻…' : '↻'}
                        </button>
                    </div>
                </div>
                <nav className="flex gap-0.5 overflow-x-auto border-t border-gray-100 px-2.5 dark:border-gray-800" aria-label="Pull request sections">
                    {TAB_DEFINITIONS.map(tab => {
                        const isActive = detailTab === tab.id;
                        const passingChecks = checkRows.filter(r => r.status === 'success').length;
                        const count = tabCount(tab.id, {
                            commits: commits.length,
                            files: diff.length,
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
                                {reviewSummary && (
                                    <PrReviewSummaryPanel
                                        summary={reviewSummary}
                                        reviewers={reviewers}
                                        labels={labels}
                                        url={pr.url}
                                    />
                                )}
                                <PrConversationPanel events={timeline} />
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
                                files={diff}
                                diffText={rawDiff}
                                isMobile={isMobile}
                                workspaceId={workspaceId}
                                classificationKey={classificationKey}
                                onPopOut={handlePopOut}
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

            {assistantOpen && assistantPresentation === 'lens' && (
                <PullRequestChatPlacementFrame
                    workspaceId={workspaceId}
                    remoteUrl={remoteUrl}
                    repoId={String(repoId)}
                    prId={String(prId)}
                    prNumber={pr.number}
                    prTitle={pr.title}
                    presentation="lens"
                    onClose={closeAssistant}
                    isMinimized={assistantMinimized}
                    onMinimize={minimizeAssistant}
                    onRestore={restoreAssistant}
                    onPin={pinAssistant}
                />
            )}

            {assistantPresentation === 'side-panel' && (
                <PrAiAssistantDrawer
                    open={assistantOpen}
                    onClose={closeAssistant}
                    workspaceId={workspaceId}
                    remoteUrl={remoteUrl}
                    repoId={String(repoId)}
                    prId={String(prId)}
                    prNumber={pr.number}
                    prTitle={pr.title}
                    presentation={assistantLensEnabled && assistantPinned && assistantIsDesktop ? 'side-panel' : undefined}
                    onUnpin={assistantLensEnabled && assistantPinned && assistantIsDesktop ? unpinAssistant : undefined}
                />
            )}
        </div>
    );
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

