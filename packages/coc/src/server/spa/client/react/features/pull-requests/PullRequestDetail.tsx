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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../ui';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { formatRelativeTime } from '../../utils/format';
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
import { createPrDiffSource } from '../git/diff/diffSource';
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
    reviewRiskTextClass,
} from './pr-detail-summary';
import type { PullRequest, PullRequestCommit, CommentThread, PullRequestCheck } from './pr-utils';
import { parseDiffFileList, type FileChange } from '../git/diff';
import type { PrDetailTab } from '../../types/dashboard';
import { popOutOpened } from '../../utils/popOutWindow';

export interface PullRequestDetailProps {
    repoId: string;
    workspaceId: string;
    /** Concrete clone owner used for selection attachment routing. */
    attachmentDestinationId?: string;
    remoteUrl?: string | null;
    prId: number | string;
    onBack: () => void;
    /** When true (mobile), renders the back button. Hidden on desktop. */
    isMobile?: boolean;
    selectedTab?: string;
    onNavigateTab?: (tab: PrDetailTab) => void;
}

const TAB_DEFINITIONS: Array<{ id: PrDetailTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'files',    label: 'Files' },
    { id: 'commits',  label: 'Commits' },
    { id: 'checks',   label: 'Checks' },
];

const EMPTY_FILES: FileChange[] = [];

const MENU_ITEM_CLASS = 'block w-full px-3 py-1.5 text-left text-gray-800 hover:bg-gray-100 disabled:opacity-60 dark:text-gray-200 dark:hover:bg-gray-800';

function statusDotClass(status: string): string {
    switch (status) {
        case 'open':   return 'bg-green-500';
        case 'merged': return 'bg-purple-500';
        case 'closed': return 'bg-red-500';
        default:       return 'bg-gray-400';
    }
}

export function PullRequestDetail({ repoId, workspaceId, attachmentDestinationId, remoteUrl, prId, onBack, isMobile = false, selectedTab, onNavigateTab }: PullRequestDetailProps) {
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
    const requestedTab = TAB_DEFINITIONS.some(tab => tab.id === selectedTab) ? selectedTab as PrDetailTab : 'overview';
    const [detailTab, setDetailTab] = useState<PrDetailTab>(requestedTab);
    const [aiPassRunning, setAiPassRunning] = useState(false);
    const [aiPassDone, setAiPassDone] = useState(false);
    const [moreMenuOpen, setMoreMenuOpen] = useState(false);
    const moreMenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!moreMenuOpen) return;
        const handlePointerDown = (event: MouseEvent) => {
            if (!moreMenuRef.current?.contains(event.target as Node)) setMoreMenuOpen(false);
        };
        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [moreMenuOpen]);

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
    } = useReviewChatPresentation({ target: prChatTarget, isDesktop: isMobile ? false : undefined });
    const openAssistant = useCallback(() => {
        if (!assistantOpen) toggleAssistant();
    }, [assistantOpen, toggleAssistant]);

    // Explicit pop-out action for the Files tab. Inline (right-panel) diff is
    // now the default click path; this opens the separate review window.
    const handlePopOut = useCallback((_filePath: string) => {
        const cloneBaseUrl = attachmentDestinationId === workspaceId
            ? undefined : lookupCloneBaseUrl(attachmentDestinationId ?? workspaceId);
        const url = buildGitPrPopOutUrl(workspaceId, String(repoId), String(prId), originId, cloneBaseUrl, attachmentDestinationId);
        const win = window.open(url, `coc-git-review-pr-${prId}`, 'width=1200,height=800');
        if (popOutOpened(win)) {
            markPoppedOut(gitReviewPrPopOutKey(workspaceId, String(prId)));
        }
    }, [workspaceId, attachmentDestinationId, originId, repoId, prId, markPoppedOut]);

    const switchTab = useCallback(
        (tab: PrDetailTab) => {
            setDetailTab(tab);
            onNavigateTab?.(tab);
        },
        [onNavigateTab],
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
        if (requestedTab !== detailTab) {
            setDetailTab(requestedTab);
        }
    }, [requestedTab]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Drives the inline Files tab's shared FileDiffPanel. `files` is the same
    // order the changed-files list renders, so its ←/→ cross-file navigation
    // matches what the reviewer sees.
    const diffFilePaths = useMemo(() => diff.map(file => file.path), [diff]);
    const prDiffSource = useMemo(
        () => createPrDiffSource(workspaceId, String(repoId), String(prId), {
            originId,
            headSha,
            baseSha: pr?.baseSha,
            routingTarget: attachmentDestinationId === workspaceId ? null : attachmentDestinationId,
            files: diffFilePaths,
            title: pr?.title,
        }),
        [workspaceId, repoId, prId, originId, headSha, pr?.baseSha, diffFilePaths, pr?.title, attachmentDestinationId],
    );
    // Same persistence key the pop-out review window uses, so reviewed/visited
    // state is shared between the two surfaces rather than duplicated.
    const reviewPersistence = useMemo(
        () => ({ originId, workspaceId, repoId: String(repoId), prId: String(prId) }),
        [originId, workspaceId, repoId, prId],
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
    const autoMerge = autoMergeBadge(pr.autoMerge);
    const reviewers = pr.reviewers ?? [];
    const labels = pr.labels ?? [];
    const unresolvedCount = reviewSummary?.unresolvedCount ?? 0;
    const showRisk = reviewSummary?.risk === 'Medium' || reviewSummary?.risk === 'High';
    const updatedAt = pr.updatedAt ?? pr.createdAt;
    const deltaText = diffStats
        ? `+${diffStats.additions} −${diffStats.deletions}`
        : '';

    return (
        <div className="flex h-full flex-col overflow-hidden bg-white dark:bg-gray-900" data-testid="pr-detail">
            <section className="shrink-0 border-b border-gray-200 dark:border-gray-700">
                {isMobile && (
                    <button
                        className="px-2 pt-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
                        onClick={handleBack}
                        data-testid="back-button"
                    >
                        ← Back to list
                    </button>
                )}

                <div className="flex items-start gap-3 px-4 pb-2 pt-3" data-testid="pr-hero-row">
                    <div className="min-w-0 flex-1">
                        <h1 className="m-0 flex min-w-0 items-baseline gap-2 text-[18px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                            <span className="truncate" data-testid="pr-title">{pr.title}</span>
                            {pr.number != null && (
                                <span className="shrink-0 font-normal text-gray-400 dark:text-gray-500" data-testid="pr-number">
                                    #{pr.number}
                                </span>
                            )}
                        </h1>
                        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-gray-500 dark:text-gray-400">
                            <span className="inline-flex shrink-0 items-center gap-1.5" data-testid="pr-status-badge">
                                <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', statusDotClass(pr.status))} />
                                {badge.label}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 break-all" data-testid="pr-branches">
                                <span>{pr.author?.displayName ?? 'unknown'}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono">{pr.sourceBranch} → {pr.targetBranch}</span>
                            </span>
                            {deltaText && (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span className="shrink-0 font-mono tabular-nums" data-testid="pr-delta">{deltaText}</span>
                                </>
                            )}
                            {updatedAt && (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span className="shrink-0" title={formatTimestamp(updatedAt)} data-testid="pr-updated">
                                        updated {formatRelativeTime(updatedAt)}
                                    </span>
                                </>
                            )}
                        </div>
                        {(autoMerge || showRisk || unresolvedCount > 0) && (
                            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] text-gray-500 dark:text-gray-400" data-testid="pr-status-line">
                                {autoMerge && (
                                    <span
                                        className={pr.autoMerge?.state === 'blocked' ? 'text-orange-600 dark:text-orange-400' : undefined}
                                        data-testid="pr-auto-merge-badge"
                                    >
                                        {autoMerge.label}
                                    </span>
                                )}
                                {showRisk && reviewSummary && (
                                    <span className={reviewRiskTextClass(reviewSummary.risk)} data-testid="pr-risk-pill">
                                        {reviewSummary.risk} risk
                                    </span>
                                )}
                                {unresolvedCount > 0 && (
                                    <span className="text-orange-600 dark:text-orange-400" data-testid="pr-unresolved">
                                        {unresolvedCount} unresolved
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                        <button
                            type="button"
                            onClick={openAssistant}
                            className="inline-flex h-7 items-center rounded-full bg-blue-600 px-3 text-[12px] font-medium text-white hover:bg-blue-700"
                            data-testid="pr-open-ai-assistant"
                        >
                            Ask AI
                        </button>
                        <div className="relative" ref={moreMenuRef}>
                            <button
                                type="button"
                                aria-label="More actions"
                                aria-haspopup="menu"
                                aria-expanded={moreMenuOpen}
                                onClick={() => setMoreMenuOpen(open => !open)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                                data-testid="pr-more-actions"
                            >
                                ⋯
                            </button>
                            {moreMenuOpen && (
                                <div
                                    role="menu"
                                    className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 text-[13px] shadow-lg dark:border-gray-700 dark:bg-gray-900"
                                    data-testid="pr-more-menu"
                                >
                                    <button
                                        type="button"
                                        role="menuitem"
                                        disabled={aiPassRunning}
                                        onClick={() => { setMoreMenuOpen(false); handleRunAiPass(); }}
                                        className={MENU_ITEM_CLASS}
                                        data-testid="pr-run-ai-pass"
                                    >
                                        {aiPassRunning ? 'Reviewing…' : aiPassDone ? 'AI review done' : 'AI review'}
                                    </button>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => { setMoreMenuOpen(false); void handleCopySummary(); }}
                                        className={MENU_ITEM_CLASS}
                                        data-testid="pr-copy-summary"
                                    >
                                        Copy summary
                                    </button>
                                    {pr.url && (
                                        <a
                                            href={pr.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            role="menuitem"
                                            onClick={() => setMoreMenuOpen(false)}
                                            className={MENU_ITEM_CLASS}
                                            data-testid="header-external-link"
                                        >
                                            Open in browser
                                        </a>
                                    )}
                                    <button
                                        type="button"
                                        role="menuitem"
                                        disabled={refreshing}
                                        onClick={() => { setMoreMenuOpen(false); handleRefresh(); }}
                                        className={MENU_ITEM_CLASS}
                                        data-testid="pr-refresh"
                                    >
                                        {refreshing ? 'Refreshing…' : 'Refresh'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <nav className="flex gap-4 overflow-x-auto px-4" aria-label="Pull request sections">
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
                                aria-current={isActive ? 'page' : undefined}
                                className={cn(
                                    'inline-flex min-h-[32px] items-center gap-1.5 border-b px-0.5 py-0 text-[13px] whitespace-nowrap transition-colors',
                                    isActive
                                        ? 'border-gray-900 font-semibold text-gray-900 dark:border-gray-100 dark:text-gray-100'
                                        : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200',
                                )}
                                data-testid={`tab-${tab.id}`}
                            >
                                {tab.label}
                                {count !== null && (
                                    <span className="font-normal tabular-nums text-gray-400 dark:text-gray-500">{count}</span>
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
                    <div className="w-full px-4 pb-7 pt-4" data-testid="overview-tab">
                        <div className={cn('grid gap-6', !isMobile && threads.length > 0 && 'lg:grid-cols-[minmax(0,1fr)_264px]')}>
                            <div className="grid gap-5 divide-y divide-gray-200 dark:divide-gray-800 [&>*+*]:pt-5">
                                {reviewSummary && (
                                    <PrReviewSummaryPanel
                                        summary={reviewSummary}
                                        reviewers={reviewers}
                                        labels={labels}
                                    />
                                )}
                                <PrConversationPanel events={timeline} />
                                {threads.length > 0 && (
                                    <section data-testid="threads-tab">
                                        <h2 className="m-0 mb-2 text-[15px] font-semibold text-gray-900 dark:text-gray-100">
                                            Comment threads <span className="font-normal text-gray-400">{threads.length}</span>
                                        </h2>
                                        <ThreadList threads={threads} />
                                    </section>
                                )}
                            </div>
                            {threads.length > 0 && (
                                <PrAiGroupedThreads groups={threadGroups} totalThreads={threads.length} />
                            )}
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
                                attachmentDestinationId={attachmentDestinationId}
                                classificationKey={classificationKey}
                                onPopOut={handlePopOut}
                                diffSource={prDiffSource}
                                headSha={headSha}
                                reviewPersistence={reviewPersistence}
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
                        <div className={cn("grid gap-2", !isMobile && "lg:grid-cols-[minmax(0,1fr)_264px]")}>
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
