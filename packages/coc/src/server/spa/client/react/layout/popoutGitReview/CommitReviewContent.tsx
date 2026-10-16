/**
 * Commit adapter for the pop-out review kernel.
 *
 * Loads commit and file metadata, then configures the shared single-row review
 * toolbar, review model, and layout. Commit review progress is session-local — there is no
 * server persistence for commits.
 */

import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '../../ui';
import { getGitReviewClient } from '../../features/git/diff/diffSource';
import { CommitChatPanel } from '../../features/git/commits/CommitChatPanel';
import { CommitChatPlacementFrame } from '../../features/git/commits/CommitChatPlacementFrame';
import { createCommitDiffSource } from '../../features/git/diff/diffSource';
import { useCommitReviewFiles } from '../../features/git/hooks/useCommitReviewFiles';
import { GitFileReview } from '../../features/git/diff/GitFileReview';
import { useCommitChatPresentation } from '../../features/git/hooks/useCommitChatPresentation';
import { useClassification } from '../../features/git/diff/useClassification';
import { usePrReviewProgress } from '../../features/git/diff/usePrReviewProgress';
import { useModalJobAiSelection } from '../../shared/ModalJobAiControls';
import { useCommitReviewHeader } from '../../features/git/commits/useCommitReviewHeader';
import { CommitDetailIcon } from '../../features/git/commits/CommitDetailIcon';
import { PopOutReviewChatLens, PopOutReviewChatSidePanel } from './PopOutReviewChatSlot';
import { usePopOutReviewModel } from './usePopOutReviewModel';
import type { ClassificationKey } from '../../features/git/diff/diffSource';
import type { GitCommitItem } from '../../features/git/commits/CommitList';

export interface CommitReviewContentProps {
    workspaceId: string;
    commitHash: string;
    attachmentDestinationId?: string;
    onTitleLoaded?: (title: string | undefined) => void;
}

export function CommitReviewContent({ workspaceId, commitHash, attachmentDestinationId, onTitleLoaded }: CommitReviewContentProps) {
    const [commit, setCommit] = useState<GitCommitItem | null>(null);
    const [loading, setLoading] = useState(true);
    const chat = useCommitChatPresentation({ workspaceId, commitHash });

    // Classification hook — uses commit hash as the identifier; session-scoped
    const classificationKey: ClassificationKey = useMemo(
        () => ({ type: 'commit', repoId: workspaceId, identifier: commitHash }),
        [workspaceId, commitHash],
    );
    const aiSelection = useModalJobAiSelection({ workspaceId, mode: 'ask' });
    const classification = useClassification(classificationKey, aiSelection.resolved, { workspaceId });

    // Review progress — session-local only (no server persistence for commits)
    const progress = usePrReviewProgress(JSON.stringify([attachmentDestinationId ?? workspaceId, workspaceId, commitHash]));

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setCommit(null);
        onTitleLoaded?.(undefined);
        Promise.resolve().then(() => getGitReviewClient(workspaceId, attachmentDestinationId === workspaceId ? null : attachmentDestinationId).git.getCommit(workspaceId, commitHash))
            .then((data: GitCommitItem) => {
                if (cancelled) return;
                setCommit(data);
                onTitleLoaded?.(data.subject);
            })
            .catch(() => { if (!cancelled) setCommit(null); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [workspaceId, commitHash, attachmentDestinationId, onTitleLoaded]);

    const fileState = useCommitReviewFiles(workspaceId, commitHash, attachmentDestinationId);
    const fileList = fileState.files;
    const filePaths = useMemo(() => fileList.map(file => file.path), [fileList]);
    const source = useMemo(() => createCommitDiffSource(workspaceId, commitHash, { commit: commit ?? undefined, files: filePaths, routingTarget: attachmentDestinationId === workspaceId ? null : attachmentDestinationId }), [workspaceId, commitHash, commit, filePaths, attachmentDestinationId]);
    const model = usePopOutReviewModel({ files: fileList, progress, classification, diffIdentity: `${attachmentDestinationId ?? workspaceId}:${workspaceId}:${commitHash}` });
    const header = useCommitReviewHeader({
        commit, fileCount: fileList.length, classification, aiSelection, classificationEnabled: model.classificationEnabled,
        testIdPrefix: 'commit-popout', resetKey: JSON.stringify([attachmentDestinationId ?? workspaceId, workspaceId, commitHash]),
        actions: [{ id: 'chat', label: 'Toggle AI chat', icon: <CommitDetailIcon name="spark" />, onClick: chat.toggleChat, pressed: chat.chatOpen, testId: 'commit-popout-chat-toggle' }],
    });

    if (loading) {
        return (
            <div className="flex items-center justify-center flex-1 gap-2 text-xs text-[#848484]">
                <Spinner size="sm" /> Loading commit…
            </div>
        );
    }

    return (
        <div className="relative flex flex-col flex-1 min-h-0 min-w-0">
            <div className="relative flex flex-1 min-h-0 min-w-0">
                <GitFileReview workspaceId={workspaceId} attachmentDestinationId={attachmentDestinationId}
                    comparisonKey={commitHash} source={source} files={fileList} selectedPath={model.selectedFilePath}
                    onSelect={model.handleNavigateToFile} initialHunkTarget={model.hunkTarget} onDiffEngineChange={model.onDiffEngineChange} reviewChat={chat}
                    loading={fileState.loading} error={fileState.error} onRetry={fileState.retry}
                    reviewedFiles={progress.state.reviewedFiles} onToggleReviewed={progress.toggleReviewed} header={header}
                    getHunkClassification={classification.getHunkClassification}
                    hunkActiveFilters={classification.state.status === 'ready' ? classification.state.activeFilters : undefined}
                />
                    <PopOutReviewChatSidePanel
                        chat={chat}
                        containerTestId="commit-popout-chat-container"
                        framed={(
                            <CommitChatPlacementFrame
                                sourceSelectionId={attachmentDestinationId}
                                newChatSeedDestinationId={attachmentDestinationId ?? workspaceId}
                                workspaceId={workspaceId}
                                commitHash={commitHash}
                                commitMessage={commit?.subject}
                                presentation="side-panel"
                                onClose={chat.closeChat}
                                onUnpin={chat.unpinChat}
                            />
                        )}
                        plain={(
                            <CommitChatPanel
                                sourceSelectionId={attachmentDestinationId}
                                newChatSeedDestinationId={attachmentDestinationId ?? workspaceId}
                                workspaceId={workspaceId}
                                commitHash={commitHash}
                                commitMessage={commit?.subject}
                                onClose={chat.closeChat}
                            />
                        )}
                    />
            </div>
            <PopOutReviewChatLens chat={chat}>
                <CommitChatPlacementFrame
                    sourceSelectionId={attachmentDestinationId}
                    newChatSeedDestinationId={attachmentDestinationId ?? workspaceId}
                    workspaceId={workspaceId}
                    commitHash={commitHash}
                    commitMessage={commit?.subject}
                    presentation="lens"
                    onClose={chat.closeChat}
                    isMinimized={chat.isMinimized}
                    onMinimize={chat.minimizeChat}
                    onRestore={chat.restoreChat}
                    onPin={chat.pinChat}
                />
            </PopOutReviewChatLens>
        </div>
    );
}
