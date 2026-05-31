/**
 * PopOutGitReviewShell — standalone shell for git commit/branch-range/PR review
 * popped into a separate browser window.
 *
 * Rendered when `window.location.hash` starts with `#popout/git-review`.
 *
 * URL formats:
 *   Commit:       `/?workspace=<wsId>#popout/git-review/<commitHash>`
 *   Branch-range: `/?workspace=<wsId>#popout/git-review/branch-range`
 *   PR:           `/?workspace=<wsId>&repo=<repoId>#popout/git-review/pr/<prId>`
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AppProvider } from '../contexts/AppContext';
import { QueueProvider } from '../contexts/QueueContext';
import { ThemeProvider } from './ThemeProvider';
import { ToastProvider } from '../contexts/ToastContext';
import { ToastContainer, useToast } from '../ui';
import { getSpaCocClient } from '../api/cocClient';
import { CommitDetail } from '../features/git/commits/CommitDetail';
import { BranchRangeOverview } from '../features/git/branches/BranchRangeOverview';
import { FileDiffPanel } from '../features/git/diff/FileDiffPanel';
import { createCommitDiffSource, createBranchRangeDiffSource, createPrDiffSource } from '../features/git/diff/diffSource';
import { PopOutFilePanel } from '../features/git/diff/PopOutFilePanel';
import { Spinner } from '../ui';
import { useCachedDiff } from '../features/git/hooks/useCommitDiffCache';
import { parseDiffFileList } from '../features/git/diff/UnifiedDiffViewer';
import { useFileCommentCounts } from '../features/git/hooks/useFileCommentCounts';
import { computeDiffCommentKey } from '../../comments/diff-comment-utils';
import {
    useGitReviewPopOutChannel,
    type GitReviewPopOutMessage,
    gitReviewPopOutKey,
    gitReviewBranchPopOutKey,
    gitReviewPrPopOutKey,
} from '../contexts/GitReviewPopOutContext';
import { getHostname } from '../utils/config';
import { extractFileStatsFromDiff } from '../features/git/diff/diffSource';
import { useClassification } from '../features/git/diff/useClassification';
import type { ChatProvider } from '../features/git/diff/useClassification';
import { usePrReviewProgress } from '../features/git/diff/usePrReviewProgress';
import { pickPriorityFile } from '../features/git/diff/prPopoutPriority';
import type { ClassificationKey } from '../features/git/diff/diffSource';
import type { HunkCategory } from '../features/pull-requests/classification-types';
import { HUNK_CATEGORIES, CATEGORY_LABELS } from '../features/pull-requests/classification-types';
import { PrChatPanel } from '../features/git/commits/PrChatPanel';
import type { GitCommitItem } from '../features/git/commits/CommitList';
import type { BranchRangeInfo } from '../features/git/branches/BranchChanges';
import type { BranchRangeFile } from '../features/git/branches/BranchAllFilesDiff';
import type { FileChange } from '../features/git/diff/FileTree';
import type { GitBranchRangeResponse } from '@plusplusoneplusplus/coc-client';
import { useAgentProviders } from '../hooks/useAgentProviders';
import { useModels } from '../hooks/useModels';

// ── URL parsing ────────────────────────────────────────────────────────────────

export interface PopOutGitReviewParams {
    workspaceId: string;
    reviewType: 'commit' | 'branch-range' | 'pr';
    commitHash?: string;
    prId?: string;
    repoId?: string;
}

export function parsePopOutGitReviewRoute(hash: string, search: string): PopOutGitReviewParams | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] !== 'popout' || parts[1] !== 'git-review') return null;

    const searchParams = new URLSearchParams(search);
    const workspaceId = searchParams.get('workspace');
    if (!workspaceId) return null;

    if (parts[2] === 'branch-range') {
        return { workspaceId, reviewType: 'branch-range' };
    }

    if (parts[2] === 'pr' && parts[3]) {
        const repoId = searchParams.get('repo') ?? workspaceId;
        return { workspaceId, reviewType: 'pr', prId: decodeURIComponent(parts[3]), repoId };
    }

    // 'pr' without a prId is invalid
    if (parts[2] === 'pr') {
        return null;
    }

    if (parts[2]) {
        return { workspaceId, reviewType: 'commit', commitHash: decodeURIComponent(parts[2]) };
    }

    return null;
}

// ── Commit review content ──────────────────────────────────────────────────────

function CommitReviewContent({ workspaceId, commitHash }: { workspaceId: string; commitHash: string }) {
    const [commit, setCommit] = useState<GitCommitItem | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
    const [hunkTarget, setHunkTarget] = useState<'first' | 'last' | undefined>(undefined);
    const [fileCommentMap, setFileCommentMap] = useState<Map<string, number>>(new Map());

    const handleFileSelect = useCallback((filePath: string) => {
        setHunkTarget(undefined);
        setSelectedFilePath(prev => prev === filePath ? null : filePath);
    }, []);

    const handleNavigateToFile = useCallback((filePath: string, target: 'first' | 'last') => {
        setSelectedFilePath(filePath);
        setHunkTarget(target);
    }, []);

    const handleBack = useCallback(() => {
        setSelectedFilePath(null);
        setHunkTarget(undefined);
    }, []);

    useEffect(() => {
        setLoading(true);
        getSpaCocClient().git.getCommit(workspaceId, commitHash)
            .then((data: GitCommitItem) => {
                setCommit(data);
            })
            .catch(() => setCommit(null))
            .finally(() => setLoading(false));
    }, [workspaceId, commitHash]);

    // Fetch the diff to extract file list (shares cache with CommitDetail)
    const diffUrl = getSpaCocClient().git.commitDiffPath(workspaceId, commitHash);
    const { diff } = useCachedDiff(diffUrl, workspaceId, commitHash);
    const fileList = diff ? parseDiffFileList(diff) : [];

    // Comment counts for the commit diff
    const oldRef = `${commitHash}^`;
    const commentCounts = useFileCommentCounts(workspaceId, oldRef, commitHash);

    // Map storage keys to file paths
    useEffect(() => {
        if (commentCounts.size === 0 || fileList.length === 0) {
            setFileCommentMap(new Map());
            return;
        }
        let cancelled = false;
        (async () => {
            const map = new Map<string, number>();
            for (const file of fileList) {
                const key = await computeDiffCommentKey(workspaceId, oldRef, commitHash, file.path);
                const count = commentCounts.get(key) ?? 0;
                if (count > 0) map.set(file.path, count);
            }
            if (!cancelled) setFileCommentMap(map);
        })();
        return () => { cancelled = true; };
    }, [commentCounts, fileList.length, workspaceId, oldRef, commitHash]);

    if (loading) {
        return (
            <div className="flex items-center justify-center flex-1 gap-2 text-xs text-[#848484]">
                <Spinner size="sm" /> Loading commit…
            </div>
        );
    }

    return (
        <div className="flex flex-1 min-h-0">
            <PopOutFilePanel
                workspaceId={workspaceId}
                files={fileList}
                selectedFilePath={selectedFilePath}
                onFileSelect={handleFileSelect}
                fileCommentMap={fileCommentMap}
            />
            <div className="flex-1 min-w-0 overflow-hidden">
                {selectedFilePath ? (
                    <FileDiffPanel
                        key={`${commitHash}-${selectedFilePath}`}
                        workspaceId={workspaceId}
                        filePath={selectedFilePath}
                        source={createCommitDiffSource(workspaceId, commitHash, {
                            commit: commit ?? undefined,
                            files: fileList.map(file => file.path),
                        })}
                        onNavigateToFile={handleNavigateToFile}
                        initialHunkTarget={hunkTarget}
                        onBack={handleBack}
                        backLabel="All files"
                    />
                ) : (
                    <CommitDetail
                        workspaceId={workspaceId}
                        hash={commitHash}
                        commit={commit ?? undefined}
                        isPopOut
                    />
                )}
            </div>
        </div>
    );
}

// ── Branch range review content ────────────────────────────────────────────────

function BranchRangeReviewContent({ workspaceId }: { workspaceId: string }) {
    const [range, setRange] = useState<BranchRangeInfo | null>(null);
    const [commits, setCommits] = useState<GitCommitItem[]>([]);
    const [files, setFiles] = useState<BranchRangeFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
    const [hunkTarget, setHunkTarget] = useState<'first' | 'last' | undefined>(undefined);
    const [fileCommentMap, setFileCommentMap] = useState<Map<string, number>>(new Map());

    const handleFileSelect = useCallback((filePath: string) => {
        setHunkTarget(undefined);
        setSelectedFilePath(prev => prev === filePath ? null : filePath);
    }, []);

    const handleNavigateToFile = useCallback((filePath: string, target: 'first' | 'last') => {
        setSelectedFilePath(filePath);
        setHunkTarget(target);
    }, []);

    const handleBack = useCallback(() => {
        setSelectedFilePath(null);
        setHunkTarget(undefined);
    }, []);

    useEffect(() => {
        setLoading(true);
        setError(null);

        const client = getSpaCocClient();
        Promise.all([
            client.git.getBranchRange(workspaceId),
            client.git.listBranchRangeFiles(workspaceId).catch(() => ({ files: [] })),
        ])
            .then(([rangeData, filesData]) => {
                if (isBranchRangeInfo(rangeData)) setRange(rangeData);
                if (isBranchRangeInfo(rangeData) && rangeData.commits) setCommits(rangeData.commits);
                if (filesData.files) setFiles(filesData.files);
            })
            .catch((err: Error) => setError(err.message))
            .finally(() => setLoading(false));
    }, [workspaceId]);

    // Convert BranchRangeFile[] to FileChange[] for the file panel
    const fileChanges: FileChange[] = files.map(f => ({
        status: f.status,
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        oldPath: f.oldPath,
    }));

    // Comment counts for the branch range (uses literal refs like BranchChanges)
    const commentCounts = useFileCommentCounts(workspaceId, 'branch-base', 'branch-head');

    // Map storage keys to file paths
    useEffect(() => {
        if (commentCounts.size === 0 || files.length === 0) {
            setFileCommentMap(new Map());
            return;
        }
        let cancelled = false;
        (async () => {
            const map = new Map<string, number>();
            for (const file of files) {
                const key = await computeDiffCommentKey(workspaceId, 'branch-base', 'branch-head', file.path);
                const count = commentCounts.get(key) ?? 0;
                if (count > 0) map.set(file.path, count);
            }
            if (!cancelled) setFileCommentMap(map);
        })();
        return () => { cancelled = true; };
    }, [commentCounts, files, workspaceId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center flex-1 gap-2 text-xs text-[#848484]">
                <Spinner size="sm" /> Loading branch range…
            </div>
        );
    }

    if (error || !range) {
        return (
            <div className="flex items-center justify-center flex-1 text-xs text-[#d32f2f] dark:text-[#f48771]">
                {error || 'No branch range data available.'}
            </div>
        );
    }

    return (
        <div className="flex flex-1 min-h-0">
            <PopOutFilePanel
                workspaceId={workspaceId}
                files={fileChanges}
                selectedFilePath={selectedFilePath}
                onFileSelect={handleFileSelect}
                fileCommentMap={fileCommentMap}
            />
            <div className="flex-1 min-w-0 overflow-hidden">
                {selectedFilePath ? (
                    <FileDiffPanel
                        key={selectedFilePath}
                        workspaceId={workspaceId}
                        filePath={selectedFilePath}
                        source={createBranchRangeDiffSource(workspaceId, {
                            files: files.map(file => file.path).sort(),
                        })}
                        onNavigateToFile={handleNavigateToFile}
                        initialHunkTarget={hunkTarget}
                        onBack={handleBack}
                        backLabel="All files"
                    />
                ) : (
                    <BranchRangeOverview
                        workspaceId={workspaceId}
                        range={range}
                        commits={commits}
                        files={files}
                        isPopOut
                    />
                )}
            </div>
        </div>
    );
}

function isBranchRangeInfo(data: GitBranchRangeResponse): data is BranchRangeInfo {
    return !('onDefaultBranch' in data) && typeof data.baseRef === 'string' && typeof data.headRef === 'string';
}

// ── PR review content ──────────────────────────────────────────────────────────

function PrReviewContent({ workspaceId, repoId, prId, onTitleLoaded }: { workspaceId: string; repoId: string; prId: string; onTitleLoaded?: (title: string) => void }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [fileList, setFileList] = useState<FileChange[]>([]);
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
    const [hunkTarget, setHunkTarget] = useState<'first' | 'last' | undefined>(undefined);
    const [prTitle, setPrTitle] = useState<string | undefined>(undefined);
    const [headSha, setHeadSha] = useState<string | undefined>(undefined);
    const [chatOpen, setChatOpen] = useState(false);
    const [prioritySort, setPrioritySort] = useState(false);

    // Classification hook for PR diff
    const classificationKey: ClassificationKey | undefined =
        headSha ? { type: 'pr', repoId, identifier: `${prId}:${headSha}` } : undefined;
    const classification = useClassification(classificationKey, { workspaceId });
    const reviewProgress = usePrReviewProgress(headSha, {
        persistence: { workspaceId, repoId, prId },
    });

    // Provider/model selectors for classification
    const { providers: agentProviders } = useAgentProviders();
    const { models: agentModels } = useModels(classification.provider);
    const selectableProviders = agentProviders.filter(p => p.enabled && p.available);
    const enabledModels = agentModels.filter(m => m.enabled);

    const handleFileSelect = useCallback((filePath: string) => {
        setHunkTarget(undefined);
        setSelectedFilePath(prev => {
            const next = prev === filePath ? null : filePath;
            if (next) reviewProgress.markVisited(next);
            return next;
        });
    }, [reviewProgress]);

    const handleNavigateToFile = useCallback((filePath: string, target: 'first' | 'last') => {
        setSelectedFilePath(filePath);
        setHunkTarget(target);
        reviewProgress.markVisited(filePath);
    }, [reviewProgress]);

    const handleBack = useCallback(() => {
        setSelectedFilePath(null);
        setHunkTarget(undefined);
    }, []);

    const handleTogglePrioritySort = useCallback(() => {
        setPrioritySort(prev => !prev);
    }, []);

    const handleShowAll = useCallback(() => {
        classification.setFilters(new Set<HunkCategory>(HUNK_CATEGORIES));
    }, [classification]);

    const classifyStatusForNav = classification.state.status;
    const priorityNav = useMemo(() => {
        if (classifyStatusForNav !== 'ready') {
            return { prevPath: null as string | null, nextPath: null as string | null };
        }
        const ctx = {
            getFileBadge: classification.getFileBadge,
            reviewedFiles: reviewProgress.state.reviewedFiles,
        };
        const filters = classification.state.activeFilters;
        const next = pickPriorityFile(fileList, ctx, {
            currentPath: selectedFilePath,
            direction: 'next',
            activeFilters: filters,
        });
        const prev = pickPriorityFile(fileList, ctx, {
            currentPath: selectedFilePath,
            direction: 'prev',
            activeFilters: filters,
        });
        return { prevPath: prev.path, nextPath: next.path };
    }, [
        classifyStatusForNav,
        classification.getFileBadge,
        classification.state.activeFilters,
        reviewProgress.state.reviewedFiles,
        fileList,
        selectedFilePath,
    ]);

    const handleNextPriority = useCallback(() => {
        if (priorityNav.nextPath) {
            setSelectedFilePath(priorityNav.nextPath);
            setHunkTarget('first');
            reviewProgress.markVisited(priorityNav.nextPath);
        }
    }, [priorityNav.nextPath, reviewProgress]);

    const handlePrevPriority = useCallback(() => {
        if (priorityNav.prevPath) {
            setSelectedFilePath(priorityNav.prevPath);
            setHunkTarget('first');
            reviewProgress.markVisited(priorityNav.prevPath);
        }
    }, [priorityNav.prevPath, reviewProgress]);

    useEffect(() => {
        setLoading(true);
        setError(null);
        const client = getSpaCocClient();

        Promise.all([
            client.pullRequests.get(repoId, prId) as Promise<{ title?: string; headSha?: string }>,
            client.pullRequests.getDiff(repoId, prId),
        ])
            .then(([prData, diffText]) => {
                setPrTitle(prData.title);
                if (prData.title) onTitleLoaded?.(prData.title);
                setHeadSha(prData.headSha);
                const stats = extractFileStatsFromDiff(diffText);
                setFileList(stats.map(s => ({ path: s.path, status: 'modified' as const, additions: s.additions, deletions: s.deletions })));
            })
            .catch((err: Error) => setError(err.message))
            .finally(() => setLoading(false));
    }, [repoId, prId]);

    // Sync the current selection into the persistence snapshot so reloads
    // remember which file the reviewer was on.
    useEffect(() => {
        reviewProgress.setLastSelectedFile(selectedFilePath);
    }, [selectedFilePath, reviewProgress]);

    const filePaths = fileList.map(f => f.path);

    if (loading) {
        return (
            <div className="flex items-center justify-center flex-1 gap-2 text-xs text-[#848484]">
                <Spinner size="sm" /> Loading PR diff…
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center flex-1 text-xs text-[#d32f2f] dark:text-[#f48771]">
                {error}
            </div>
        );
    }

    const classifyStatus = classification.state.status;
    const classifySelectClass = classifyStatus === 'loading'
        ? 'h-6 rounded border border-gray-200 bg-gray-50 px-1.5 text-[11px] text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500 cursor-not-allowed'
        : 'h-6 rounded border border-gray-300 bg-white px-1.5 text-[11px] text-gray-700 hover:border-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200';

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* Classification toolbar */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#2a2a2a]" data-testid="pr-popout-classify-bar">
                {/* Provider selector — only show when multiple providers are available */}
                {selectableProviders.length > 1 && (
                    <select
                        value={classification.provider}
                        onChange={e => classification.setProvider(e.target.value as ChatProvider)}
                        disabled={classifyStatus === 'loading'}
                        className={classifySelectClass}
                        aria-label="AI provider"
                        data-testid="pr-popout-classify-provider"
                    >
                        {selectableProviders.map(p => (
                            <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                    </select>
                )}
                {/* Model selector */}
                <select
                    value={classification.model ?? ''}
                    onChange={e => classification.setModel(e.target.value || undefined)}
                    disabled={classifyStatus === 'loading'}
                    className={classifySelectClass}
                    aria-label="AI model"
                    data-testid="pr-popout-classify-model"
                >
                    <option value="">Default</option>
                    {enabledModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={classification.classify}
                    disabled={classifyStatus === 'loading'}
                    className={
                        classifyStatus === 'loading'
                            ? 'inline-flex h-6 items-center gap-1 rounded border border-gray-300 bg-gray-100 px-2 text-[11px] font-medium text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-500 cursor-wait'
                            : 'inline-flex h-6 items-center gap-1 rounded border border-indigo-400 bg-indigo-50 px-2 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-200 dark:hover:bg-indigo-900/50'
                    }
                    data-testid="pr-popout-classify-button"
                >
                    {classifyStatus === 'loading' ? (
                        <>
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Classifying…
                        </>
                    ) : classifyStatus === 'ready' ? 'Re-classify' : 'Classify'}
                </button>
                <button
                    type="button"
                    onClick={() => setChatOpen(prev => !prev)}
                    className={`inline-flex h-6 items-center gap-1 rounded border px-2 text-[11px] font-medium ${
                        chatOpen
                            ? 'border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-200'
                            : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                    data-testid="pr-popout-chat-toggle"
                >
                    💬 Chat
                </button>
                {classification.state.error && (
                    <span className="text-[10px] text-red-600 dark:text-red-400">
                        {classification.state.error}
                    </span>
                )}
            </div>
            {/* Classification filter bar — visible when results are ready */}
            {classifyStatus === 'ready' && (
                <div className="flex items-center gap-3 px-3 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#262626]" data-testid="pr-popout-filter-bar">
                    <span className="text-[10px] text-[#616161] dark:text-[#999] font-medium">Filter:</span>
                    {HUNK_CATEGORIES.map(cat => {
                        const active = classification.state.activeFilters.has(cat);
                        return (
                            <label
                                key={cat}
                                className="flex items-center gap-1 text-[11px] cursor-pointer select-none"
                                data-testid={`pr-popout-filter-${cat}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={active}
                                    onChange={() => classification.toggleFilter(cat as HunkCategory)}
                                    className="h-3 w-3 rounded"
                                />
                                <span className={active ? 'text-[#1e1e1e] dark:text-[#ccc]' : 'text-[#848484]'}>
                                    {CATEGORY_LABELS[cat]}
                                </span>
                            </label>
                        );
                    })}
                </div>
            )}
            {/* Main content */}
            <div className="flex flex-1 min-h-0">
                <PopOutFilePanel
                    workspaceId={workspaceId}
                    files={fileList}
                    selectedFilePath={selectedFilePath}
                    onFileSelect={handleFileSelect}
                    isFileDimmed={classifyStatus === 'ready' ? classification.isFileDimmed : undefined}
                    getFileBadge={classifyStatus === 'ready' ? classification.getFileBadge : undefined}
                    prioritySort={prioritySort}
                    onTogglePrioritySort={classifyStatus === 'ready' ? handleTogglePrioritySort : undefined}
                    activeFilters={classifyStatus === 'ready' ? classification.state.activeFilters : undefined}
                    onShowAll={classifyStatus === 'ready' ? handleShowAll : undefined}
                    reviewedFiles={reviewProgress.state.reviewedFiles}
                    visitedFiles={reviewProgress.state.visitedFiles}
                    onPrevPriorityFile={classifyStatus === 'ready' ? handlePrevPriority : undefined}
                    onNextPriorityFile={classifyStatus === 'ready' ? handleNextPriority : undefined}
                    prevPriorityDisabled={priorityNav.prevPath === null}
                    nextPriorityDisabled={priorityNav.nextPath === null}
                />
                <div className="flex-1 min-w-0 overflow-hidden">
                    {selectedFilePath ? (
                        <FileDiffPanel
                            key={`pr-${prId}-${selectedFilePath}`}
                            workspaceId={workspaceId}
                            filePath={selectedFilePath}
                            source={createPrDiffSource(workspaceId, repoId, prId, {
                                headSha,
                                files: filePaths,
                                title: prTitle,
                            })}
                            onNavigateToFile={handleNavigateToFile}
                            initialHunkTarget={hunkTarget}
                            onBack={handleBack}
                            backLabel="All files"
                            showSourceLabel={false}
                            isReviewed={reviewProgress.isReviewed(selectedFilePath)}
                            onToggleReviewed={() => reviewProgress.toggleReviewed(selectedFilePath)}
                            getHunkClassification={classifyStatus === 'ready' ? classification.getHunkClassification : undefined}
                            hunkActiveFilters={classifyStatus === 'ready' ? classification.state.activeFilters : undefined}
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center flex-1 gap-2 text-xs text-[#848484]">
                            <span>Select a file to view its diff</span>
                            <span className="text-[10px]">{fileList.length} file{fileList.length !== 1 ? 's' : ''} changed</span>
                        </div>
                    )}
                </div>
                {/* PR Chat panel */}
                {chatOpen && (
                    <div className="w-[340px] shrink-0 border-l border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="pr-popout-chat-container">
                        <PrChatPanel
                            workspaceId={workspaceId}
                            prId={prId}
                            filePath={selectedFilePath ?? undefined}
                            onClose={() => setChatOpen(false)}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Inner content (uses toast + channel) ───────────────────────────────────────

function PopOutGitReviewContent({ params }: { params: PopOutGitReviewParams }) {
    const { toasts, addToast, removeToast } = useToast();
    const hasNotifiedRef = useRef(false);
    const [prTitle, setPrTitle] = useState<string | undefined>(undefined);
    const [titleExpanded, setTitleExpanded] = useState(true);

    const key = params.reviewType === 'commit'
        ? gitReviewPopOutKey(params.workspaceId, params.commitHash!)
        : params.reviewType === 'pr'
            ? gitReviewPrPopOutKey(params.workspaceId, params.prId!)
            : gitReviewBranchPopOutKey(params.workspaceId);

    const handleMessage = useCallback((msg: GitReviewPopOutMessage) => {
        if (msg.type === 'git-review-popout-restore' && msg.key === key) {
            window.close();
        }
    }, [key]);

    const { postMessage } = useGitReviewPopOutChannel(handleMessage);

    useEffect(() => {
        if (hasNotifiedRef.current) return;
        hasNotifiedRef.current = true;
        postMessage({ type: 'git-review-popout-opened', key });

        const handleBeforeUnload = () => {
            postMessage({ type: 'git-review-popout-closed', key });
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [key, postMessage]);

    useEffect(() => {
        const hostname = getHostname();
        const brand = hostname ? `CoC @ ${hostname}` : 'CoC';
        const base = params.reviewType === 'commit'
            ? `Commit ${params.commitHash!.slice(0, 7)}`
            : params.reviewType === 'pr'
                ? `PR #${params.prId}`
                : 'Branch Range Review';
        const title = params.reviewType === 'pr' && prTitle ? `${base} — ${prTitle}` : base;
        document.title = `${title} — ${brand}`;
    }, [params, prTitle]);

    return (
        <ToastProvider value={{ addToast, removeToast, toasts }}>
            <div className="flex flex-col h-screen bg-white dark:bg-[#1e1e1e]" data-testid="popout-git-review-shell">
                {/* Minimal top bar */}
                <div className="flex flex-col px-4 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526]">
                    {/* Primary title row */}
                    <div className="flex items-center justify-between" style={{ minHeight: 44 }}>
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm">📝</span>
                            <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate" data-testid="popout-git-review-title">
                                {params.reviewType === 'commit'
                                    ? `Commit ${params.commitHash!.slice(0, 7)}`
                                    : params.reviewType === 'pr'
                                        ? `PR #${params.prId}`
                                        : 'Branch Range Review'}
                            </span>
                        </div>
                        {params.reviewType === 'pr' && prTitle && (
                            <button
                                type="button"
                                onClick={() => setTitleExpanded(prev => !prev)}
                                className="ml-2 shrink-0 text-[#848484] hover:text-[#1e1e1e] dark:text-[#666] dark:hover:text-[#ccc] transition-colors"
                                aria-label={titleExpanded ? 'Collapse PR title' : 'Expand PR title'}
                                data-testid="popout-pr-title-toggle"
                            >
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                                    {titleExpanded
                                        ? <path d="M6 4l-4 4h8z" />
                                        : <path d="M6 8l4-4H2z" />}
                                </svg>
                            </button>
                        )}
                    </div>
                    {/* Collapsible PR title row */}
                    {params.reviewType === 'pr' && prTitle && titleExpanded && (
                        <div
                            className="pb-2 text-xs text-[#616161] dark:text-[#9d9d9d] truncate"
                            data-testid="popout-pr-title-description"
                            title={prTitle}
                        >
                            {prTitle}
                        </div>
                    )}
                </div>
                {/* Review content with file panel */}
                <div className="flex flex-1 min-h-0 overflow-hidden">
                    {params.reviewType === 'commit' ? (
                        <CommitReviewContent workspaceId={params.workspaceId} commitHash={params.commitHash!} />
                    ) : params.reviewType === 'pr' ? (
                        <PrReviewContent workspaceId={params.workspaceId} repoId={params.repoId!} prId={params.prId!} onTitleLoaded={setPrTitle} />
                    ) : (
                        <BranchRangeReviewContent workspaceId={params.workspaceId} />
                    )}
                </div>
            </div>
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </ToastProvider>
    );
}

// ── Shell entry point ──────────────────────────────────────────────────────────

export function PopOutGitReviewShell() {
    const params = parsePopOutGitReviewRoute(window.location.hash, window.location.search);

    if (!params) {
        return (
            <div className="flex items-center justify-center h-screen text-sm text-[#848484]">
                Invalid pop-out URL.
            </div>
        );
    }

    return (
        <AppProvider>
            <QueueProvider>
                <ThemeProvider>
                    <PopOutGitReviewContent params={params} />
                </ThemeProvider>
            </QueueProvider>
        </AppProvider>
    );
}
