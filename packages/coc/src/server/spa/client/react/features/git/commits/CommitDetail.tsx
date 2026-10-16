/**
 * CommitDetail — right-panel view for a selected commit.
 *
 * Shows metadata, review actions and one focused file diff with persistent navigation.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useCommitReviewFiles } from '../hooks/useCommitReviewFiles';
import { GitFileReview } from '../diff/GitFileReview';
import { createCommitDiffSource } from '../diff/diffSource';
import { useAllCommitComments } from '../hooks/useAllCommitComments';
import { CommentSidebar } from '../../../tasks/comments/CommentSidebar';
import { CommitReviewChat } from './CommitReviewChat';
import { useCommitChatPresentation, type UseCommitChatPresentationReturn } from '../hooks/useCommitChatPresentation';
import { shouldSkipResolveDialog } from '../../../shared/ResolveContextDialog';
import { useQueue } from '../../../contexts/QueueContext';
import { useGitReviewPopOut, gitReviewPopOutKey } from '../../../contexts/GitReviewPopOutContext';
import { buildGitReviewPopOutUrl } from '../../../layout/Router';
import { lookupCloneBaseUrl, resolveCloneRoute } from '../../../repos/cloneRegistry';
import { useCloneBaseUrl } from '../../../repos/cloneRouting';
import { useClassification } from '../diff/useClassification';
import { useModalJobAiSelection } from '../../../shared/ModalJobAiControls';
import { usePrReviewProgress } from '../diff/usePrReviewProgress';
import { pickPriorityFile } from '../diff/prPopoutPriority';
import type { ClassificationKey } from '../diff/diffSource';
import { CommitDetailIcon } from './CommitDetailIcon';
import { useCommitReviewHeader } from './useCommitReviewHeader';
import type { GitReviewToolbarAction } from '../diff/GitReviewToolbar';
import type { DiffComment } from '../../../../comments/diff-comment-types';
import type { AnyComment } from '../../../../comments/shared-comment-types';
import type { GitCommitItem } from './CommitList';
import { popOutOpened } from '../../../utils/popOutWindow';

export interface CommitDetailProps {
    workspaceId: string;
    attachmentDestinationId?: string;
    /** Commit-level host keeps chat mounted across overview and file navigation. */
    reviewChat?: UseCommitChatPresentationReturn;
    hash?: string;
    commit?: GitCommitItem;
    isPopOut?: boolean;
    /** When set, the viewer scrolls to the given file's diff section. */
    scrollToFilePath?: string | null;
    /** Called when a classification result becomes available for this commit. */
    onClassified?: () => void;
    onNavigateToFile?: (path: string, target: 'first' | 'last') => void;
    initialHunkTarget?: 'first' | 'last';
}

export function CommitDetail(props: CommitDetailProps) {
    const owner = props.attachmentDestinationId;
    const endpoint = useCloneBaseUrl(owner === props.workspaceId ? undefined : owner ?? props.workspaceId);
    if (owner && owner !== props.workspaceId && resolveCloneRoute(owner).kind === 'unresolved-remote') {
        return <div role="alert" className="p-2 text-xs">Git review owner is unavailable</div>;
    }
    return <CommitDetailBody key={JSON.stringify([owner ?? props.workspaceId, props.workspaceId, props.hash, endpoint])} {...props} />;
}

function CommitDetailBody({ workspaceId, attachmentDestinationId, hash, commit, isPopOut, scrollToFilePath, onClassified, reviewChat, onNavigateToFile, initialHunkTarget }: CommitDetailProps) {
    const [focusComment, setFocusComment] = useState<DiffComment | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const localChat = useCommitChatPresentation({ workspaceId, commitHash: hash, supportsChat: !reviewChat });
    const chat = reviewChat ?? localChat;
    const { chatOpen, toggleChat } = chat;
    // Shared selection for priority navigation, deep links and comment jumps.
    const [navFilePath, setNavFilePath] = useState<string | null>(null);

    const fileState = useCommitReviewFiles(workspaceId, hash, attachmentDestinationId);
    const fileList = fileState.files;
    const source = useMemo(() => createCommitDiffSource(workspaceId, hash ?? '', {
        commit, files: fileList.map(file => file.path), routingTarget: attachmentDestinationId === workspaceId ? null : attachmentDestinationId,
    }), [workspaceId, hash, commit, fileList, attachmentDestinationId]);

    // Classification — session-scoped, mirrors commit popout
    const classificationKey: ClassificationKey = useMemo(
        () => ({ type: 'commit', repoId: workspaceId, identifier: hash ?? '' }),
        [workspaceId, hash],
    );
    const aiSelection = useModalJobAiSelection({ workspaceId, mode: 'ask' });
    const classification = useClassification(classificationKey, aiSelection.resolved, { workspaceId });

    // Notify parent when a classification result becomes available.
    const onClassifiedRef = useRef(onClassified);
    onClassifiedRef.current = onClassified;
    useEffect(() => {
        if (classification.state.status === 'ready') {
            onClassifiedRef.current?.();
        }
    }, [classification.state.status]);

    // Review progress — session-local only (no server persistence)
    const reviewProgress = usePrReviewProgress(JSON.stringify([attachmentDestinationId ?? workspaceId, workspaceId, hash]));

    // Priority navigation (next/prev unreviewed or high-priority file)
    const classifyStatusForNav = classification.state.status;
    const priorityNav = useMemo(() => {
        const ctx = {
            getFileBadge: classifyStatusForNav === 'ready' ? classification.getFileBadge : () => undefined,
            reviewedFiles: reviewProgress.state.reviewedFiles,
        };
        const filters = classifyStatusForNav === 'ready' ? classification.state.activeFilters : undefined;
        const next = pickPriorityFile(fileList, ctx, {
            currentPath: navFilePath,
            direction: 'next',
            activeFilters: filters,
        });
        const prev = pickPriorityFile(fileList, ctx, {
            currentPath: navFilePath,
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
        navFilePath,
    ]);

    const handleNextPriority = useCallback(() => {
        if (priorityNav.nextPath) {
            setNavFilePath(priorityNav.nextPath);
            reviewProgress.markVisited(priorityNav.nextPath);
        }
    }, [priorityNav.nextPath, reviewProgress]);

    const handlePrevPriority = useCallback(() => {
        if (priorityNav.prevPath) {
            setNavFilePath(priorityNav.prevPath);
            reviewProgress.markVisited(priorityNav.prevPath);
        }
    }, [priorityNav.prevPath, reviewProgress]);

    // Commit-level comments (only active when !rangeMode)
    const {
        comments: allCommitComments,
        loading: allCommentsLoading,
        resolveComment: resolveCommitComment,
        unresolveComment: unresolveCommitComment,
        deleteComment: deleteCommitComment,
        updateComment: updateCommitComment,
        copyAllCommentsAsPrompt: copyAllCommitCommentsAsPrompt,
        resolveWithAI: commitResolveWithAI,
        fixWithAI: commitFixWithAI,
        aiLoadingIds: commitAiLoadingIds,
        aiErrors: commitAiErrors,
        clearAiError: clearCommitAiError,
    } = useAllCommitComments(workspaceId, hash ?? '', attachmentDestinationId === workspaceId ? null : attachmentDestinationId);

    const { dispatch: queueDispatch } = useQueue();
    const { markPoppedOut } = useGitReviewPopOut();

    const handlePopOut = useCallback(() => {
        if (!hash) return;
        const cloneBaseUrl = attachmentDestinationId === workspaceId
            ? undefined : lookupCloneBaseUrl(attachmentDestinationId ?? workspaceId);
        const url = buildGitReviewPopOutUrl(workspaceId, hash, cloneBaseUrl, attachmentDestinationId);
        const win = window.open(url, `coc-git-review-${hash}`, 'width=1200,height=800');
        if (popOutOpened(win)) {
            markPoppedOut(gitReviewPopOutKey(workspaceId, hash));
        }
    }, [workspaceId, attachmentDestinationId, hash, markPoppedOut]);

    const handleResolveAllCommitWithAI = useCallback(() => {
        if (shouldSkipResolveDialog()) {
            void commitResolveWithAI();
            return;
        }
        const openCount = allCommitComments.filter(c => c.status === 'open').length;
        queueDispatch({
            type: 'OPEN_DIALOG',
            workspaceId,
            mode: 'resolve',
            resolveContext: {
                title: 'Resolve with AI',
                commentCount: openCount,
                onSubmit: (ctx: string, sk: string[]) => {
                    void commitResolveWithAI(ctx || undefined, sk.length > 0 ? sk : undefined);
                },
            },
        });
    }, [commitResolveWithAI, allCommitComments, queueDispatch, workspaceId]);

    const handleFixCommitWithAI = useCallback((id: string) => {
        if (shouldSkipResolveDialog()) {
            void commitFixWithAI(id);
            return;
        }
        queueDispatch({
            type: 'OPEN_DIALOG',
            workspaceId,
            mode: 'resolve',
            resolveContext: {
                title: 'Fix with AI',
                commentCount: 1,
                onSubmit: (ctx: string, sk: string[]) => {
                    void commitFixWithAI(id, ctx || undefined, sk.length > 0 ? sk : undefined);
                },
            },
        });
    }, [commitFixWithAI, queueDispatch, workspaceId]);

    const handleSidebarCommentClick = useCallback((comment: AnyComment) => {
        setNavFilePath((comment as DiffComment).context.filePath);
        setFocusComment(comment as DiffComment);
    }, []);
    useEffect(() => { setNavFilePath(scrollToFilePath ?? null); }, [workspaceId, hash, attachmentDestinationId, scrollToFilePath]);

    useEffect(() => { setFocusComment(null); }, [workspaceId, attachmentDestinationId, hash]);

    const actions: GitReviewToolbarAction[] = [
        ...(classification.state.status === 'ready' ? [
            { id: 'prev-priority', label: 'Previous priority file', icon: <span aria-hidden="true">↑</span>, onClick: handlePrevPriority, disabled: priorityNav.prevPath === null, testId: 'commit-prev-priority-btn' },
            { id: 'next-priority', label: 'Next priority file', icon: <span aria-hidden="true">↓</span>, onClick: handleNextPriority, disabled: priorityNav.nextPath === null, testId: 'commit-next-priority-btn' },
        ] : []),
        { id: 'comments', label: 'Toggle comments', icon: <CommitDetailIcon name="chat" />, onClick: () => setSidebarOpen(open => !open), pressed: sidebarOpen, count: allCommitComments.length, testId: 'toggle-comments-btn' },
        { id: 'chat', label: 'Toggle AI chat', icon: <CommitDetailIcon name="spark" />, onClick: toggleChat, pressed: chatOpen, testId: 'toggle-chat-btn' },
        ...(!isPopOut && hash ? [{ id: 'popout', label: 'Open in new window', icon: <CommitDetailIcon name="out" />, onClick: handlePopOut, testId: 'commit-popout-btn' }] : []),
    ];
    const header = useCommitReviewHeader({
        commit, fileCount: fileList.length, classification, aiSelection, testIdPrefix: 'commit', actions,
        resetKey: JSON.stringify([attachmentDestinationId ?? workspaceId, workspaceId, hash]),
    });

    return (
        <div className="commit-detail flex flex-col h-full overflow-hidden" data-testid="commit-detail">
            {/* Diff view + sidebar */}
            <div className="relative flex flex-1 min-h-0">
                <GitFileReview
                    workspaceId={workspaceId} attachmentDestinationId={attachmentDestinationId}
                    comparisonKey={hash ?? ''} source={source} files={fileList}
                    selectedPath={navFilePath} initialHunkTarget={initialHunkTarget}
                    onSelect={(path, target) => { setNavFilePath(path); onNavigateToFile?.(path, target); }}
                    reviewChat={chat} focusComment={focusComment} reviewedFiles={reviewProgress.state.reviewedFiles}
                    onToggleReviewed={reviewProgress.toggleReviewed} header={header}
                    loading={fileState.loading} error={fileState.error} onRetry={fileState.retry}
                    getHunkClassification={classification.getHunkClassification}
                    hunkActiveFilters={classification.state.status === 'ready' ? classification.state.activeFilters : undefined}
                />

                {sidebarOpen && (
                    <CommentSidebar
                        comments={allCommitComments}
                        loading={allCommentsLoading}
                        showFilePath
                        onResolve={(id) => {
                            const c = allCommitComments.find(x => x.id === id);
                            if (c) void resolveCommitComment(c);
                        }}
                        onUnresolve={(id) => {
                            const c = allCommitComments.find(x => x.id === id);
                            if (c) void unresolveCommitComment(c);
                        }}
                        onDelete={(id) => {
                            const c = allCommitComments.find(x => x.id === id);
                            if (c) void deleteCommitComment(c);
                        }}
                        onEdit={(id, text) => {
                            const c = allCommitComments.find(x => x.id === id);
                            if (c) void updateCommitComment(c, { comment: text });
                        }}
                        onAskAI={() => undefined}
                        onResolveAllWithAI={handleResolveAllCommitWithAI}
                        onFixWithAI={handleFixCommitWithAI}
                        aiLoadingIds={commitAiLoadingIds}
                        aiErrors={commitAiErrors}
                        onClearAiError={clearCommitAiError}
                        onCommentClick={handleSidebarCommentClick}
                        onCopyPrompt={copyAllCommitCommentsAsPrompt}
                        onClose={() => setSidebarOpen(false)}
                        data-testid="diff-comment-sidebar"
                    />
                )}

                {!reviewChat && <CommitReviewChat workspaceId={workspaceId} sourceSelectionId={attachmentDestinationId} hash={hash} commitMessage={commit?.subject} chat={chat} />}

            </div>
        </div>
    );
}
