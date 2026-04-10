/**
 * PopOutGitReviewShell — standalone shell for git commit/branch-range review
 * popped into a separate browser window.
 *
 * Rendered when `window.location.hash` starts with `#popout/git-review`.
 *
 * URL formats:
 *   Commit:       `/?workspace=<wsId>#popout/git-review/<commitHash>`
 *   Branch-range: `/?workspace=<wsId>#popout/git-review/branch-range`
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { AppProvider } from '../context/AppContext';
import { QueueProvider } from '../context/QueueContext';
import { ThemeProvider } from './ThemeProvider';
import { ToastProvider } from '../context/ToastContext';
import { ToastContainer, useToast } from '../shared';
import { CommitDetail } from '../repos/CommitDetail';
import { BranchRangeOverview } from '../repos/BranchRangeOverview';
import { Spinner } from '../shared';
import { fetchApi } from '../hooks/useApi';
import {
    useGitReviewPopOutChannel,
    type GitReviewPopOutMessage,
    gitReviewPopOutKey,
    gitReviewBranchPopOutKey,
} from '../context/GitReviewPopOutContext';
import { getHostname } from '../utils/config';
import type { GitCommitItem } from '../repos/CommitList';
import type { BranchRangeInfo } from '../repos/BranchChanges';
import type { BranchRangeFile } from '../repos/BranchAllFilesDiff';

// ── URL parsing ────────────────────────────────────────────────────────────────

export interface PopOutGitReviewParams {
    workspaceId: string;
    reviewType: 'commit' | 'branch-range';
    commitHash?: string;
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

    if (parts[2]) {
        return { workspaceId, reviewType: 'commit', commitHash: decodeURIComponent(parts[2]) };
    }

    return null;
}

// ── Commit review content ──────────────────────────────────────────────────────

function CommitReviewContent({ workspaceId, commitHash }: { workspaceId: string; commitHash: string }) {
    const [commit, setCommit] = useState<GitCommitItem | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${encodeURIComponent(commitHash)}`)
            .then((data: { commit?: GitCommitItem }) => {
                setCommit(data.commit ?? null);
            })
            .catch(() => setCommit(null))
            .finally(() => setLoading(false));
    }, [workspaceId, commitHash]);

    if (loading) {
        return (
            <div className="flex items-center justify-center flex-1 gap-2 text-xs text-[#848484]">
                <Spinner size="sm" /> Loading commit…
            </div>
        );
    }

    return (
        <CommitDetail
            workspaceId={workspaceId}
            hash={commitHash}
            commit={commit ?? undefined}
        />
    );
}

// ── Branch range review content ────────────────────────────────────────────────

function BranchRangeReviewContent({ workspaceId }: { workspaceId: string }) {
    const [range, setRange] = useState<BranchRangeInfo | null>(null);
    const [commits, setCommits] = useState<GitCommitItem[]>([]);
    const [files, setFiles] = useState<BranchRangeFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        setError(null);

        const base = `/workspaces/${encodeURIComponent(workspaceId)}/git/branch-range`;
        Promise.all([
            fetchApi(base),
            fetchApi(`${base}/files`).catch(() => ({ files: [] })),
        ])
            .then(([rangeData, filesData]: [any, any]) => {
                if (rangeData.range) setRange(rangeData.range);
                if (rangeData.commits) setCommits(rangeData.commits);
                if (filesData.files) setFiles(filesData.files);
            })
            .catch((err: Error) => setError(err.message))
            .finally(() => setLoading(false));
    }, [workspaceId]);

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
        <BranchRangeOverview
            workspaceId={workspaceId}
            range={range}
            commits={commits}
            files={files}
        />
    );
}

// ── Inner content (uses toast + channel) ───────────────────────────────────────

function PopOutGitReviewContent({ params }: { params: PopOutGitReviewParams }) {
    const { toasts, addToast, removeToast } = useToast();
    const hasNotifiedRef = useRef(false);

    const key = params.reviewType === 'commit'
        ? gitReviewPopOutKey(params.workspaceId, params.commitHash!)
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
        const title = params.reviewType === 'commit'
            ? `Commit ${params.commitHash!.slice(0, 7)}`
            : 'Branch Range Review';
        document.title = `${title} — ${brand}`;
    }, [params]);

    return (
        <ToastProvider value={{ addToast, removeToast, toasts }}>
            <div className="flex flex-col h-screen bg-white dark:bg-[#1e1e1e]" data-testid="popout-git-review-shell">
                {/* Minimal top bar */}
                <div className="flex items-center justify-between px-4 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526]" style={{ minHeight: 44 }}>
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm">📝</span>
                        <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate" data-testid="popout-git-review-title">
                            {params.reviewType === 'commit'
                                ? `Commit ${params.commitHash!.slice(0, 7)}`
                                : 'Branch Range Review'}
                        </span>
                    </div>
                </div>
                {/* Full-screen review content */}
                <div className="flex-1 min-h-0 overflow-hidden">
                    {params.reviewType === 'commit' ? (
                        <CommitReviewContent workspaceId={params.workspaceId} commitHash={params.commitHash!} />
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
