/**
 * PopOutGitReviewShell — standalone shell for git commit/branch-range/PR review
 * popped into a separate browser window.
 *
 * Rendered when `window.location.hash` starts with `#popout/git-review`.
 *
 * The shell only owns the window chrome: providers, the top bar, and the
 * review-type dispatch. Route parsing, window lifecycle, the shared review
 * model, and the per-review-type adapters live in `./popoutGitReview/`.
 *
 * URL formats:
 *   Commit:       `/?workspace=<wsId>#popout/git-review/<commitHash>`
 *   Branch-range: `/?workspace=<wsId>#popout/git-review/branch-range`
 *   PR:           `/?workspace=<wsId>&repo=<repoId>#popout/git-review/pr/<prId>`
 */

import { useState } from 'react';
import { AppProvider } from '../contexts/AppContext';
import { QueueProvider } from '../contexts/QueueContext';
import { ThemeProvider } from './ThemeProvider';
import { ToastProvider } from '../contexts/ToastContext';
import { ToastContainer, useToast } from '../ui';
import {
    parsePopOutGitReviewRoute,
    popOutGitReviewLabel,
    registerPopOutCloneBases,
    type PopOutGitReviewParams,
} from './popoutGitReview/popoutGitReviewRoute';
import { usePopOutReviewLifecycle } from './popoutGitReview/usePopOutReviewLifecycle';
import { CommitReviewContent } from './popoutGitReview/CommitReviewContent';
import { PrReviewContent } from './popoutGitReview/PrReviewContent';
import { BranchRangeReviewContent } from './popoutGitReview/BranchRangeReviewContent';

export { parsePopOutGitReviewRoute };
export type { PopOutGitReviewParams };

// ── Inner content (uses toast + channel) ───────────────────────────────────────

function PopOutGitReviewContent({ params }: { params: PopOutGitReviewParams }) {
    const { toasts, addToast, removeToast } = useToast();
    const [prTitle, setPrTitle] = useState<string | undefined>(undefined);
    const [titleExpanded, setTitleExpanded] = useState(true);

    usePopOutReviewLifecycle({ params, prTitle });

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
                                {popOutGitReviewLabel(params)}
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
                        <PrReviewContent workspaceId={params.workspaceId} repoId={params.repoId!} prId={params.prId!} originId={params.originId} onTitleLoaded={setPrTitle} />
                    ) : (
                        <BranchRangeReviewContent workspaceId={params.workspaceId} baseMode={params.baseMode} />
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

    // Seed the clone registry so workspace-scoped calls route to the remote server.
    // Must run before any child renders, since the registry is module-level; the
    // helper guards against re-registering the same route on every render.
    registerPopOutCloneBases(params);

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
