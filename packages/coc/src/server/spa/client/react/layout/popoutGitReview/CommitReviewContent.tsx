/**
 * Commit adapter for the pop-out review kernel.
 *
 * Loads the commit and its diff, then configures the shared toolbar, review
 * model, and layout. Commit review progress is session-local — there is no
 * server persistence for commits.
 */

import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '../../ui';
import { getCocClientForWorkspace } from '../../repos/cloneRegistry';
import { CommitChatPanel } from '../../features/git/commits/CommitChatPanel';
import { CommitChatPlacementFrame } from '../../features/git/commits/CommitChatPlacementFrame';
import { FileDiffPanel } from '../../features/git/diff/FileDiffPanel';
import { createCommitDiffSource } from '../../features/git/diff/diffSource';
import { parseDiffFileList } from '../../features/git/diff/UnifiedDiffViewer';
import { useCachedDiff } from '../../features/git/hooks/useCommitDiffCache';
import { useCommitChatPresentation } from '../../features/git/hooks/useCommitChatPresentation';
import { useClassification } from '../../features/git/diff/useClassification';
import { usePrReviewProgress } from '../../features/git/diff/usePrReviewProgress';
import { useModalJobAiSelection } from '../../shared/ModalJobAiControls';
import { PopOutClassificationToolbar } from './PopOutClassificationToolbar';
import { PopOutReviewLayout } from './PopOutReviewLayout';
import { PopOutReviewChatLens, PopOutReviewChatSidePanel } from './PopOutReviewChatSlot';
import { useFileCommentMap } from './useFileCommentMap';
import { popOutDiffPanelProps, usePopOutReviewModel } from './usePopOutReviewModel';
import type { ClassificationKey } from '../../features/git/diff/diffSource';
import type { GitCommitItem } from '../../features/git/commits/CommitList';

export interface CommitReviewContentProps {
    workspaceId: string;
    commitHash: string;
}

export function CommitReviewContent({ workspaceId, commitHash }: CommitReviewContentProps) {
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
    const progress = usePrReviewProgress(commitHash);

    useEffect(() => {
        setLoading(true);
        getCocClientForWorkspace(workspaceId).git.getCommit(workspaceId, commitHash)
            .then((data: GitCommitItem) => {
                setCommit(data);
            })
            .catch(() => setCommit(null))
            .finally(() => setLoading(false));
    }, [workspaceId, commitHash]);

    // Fetch the diff to extract file list (shares cache with CommitDetail)
    const diffUrl = getCocClientForWorkspace(workspaceId).git.commitDiffPath(workspaceId, commitHash);
    const { diff } = useCachedDiff(diffUrl, workspaceId, commitHash);
    const fileList = useMemo(() => diff ? parseDiffFileList(diff) : [], [diff]);
    const filePaths = useMemo(() => fileList.map(f => f.path), [fileList]);

    const model = usePopOutReviewModel({ files: fileList, progress, classification });
    const fileCommentMap = useFileCommentMap(workspaceId, `${commitHash}^`, commitHash, fileList);

    if (loading) {
        return (
            <div className="flex items-center justify-center flex-1 gap-2 text-xs text-[#848484]">
                <Spinner size="sm" /> Loading commit…
            </div>
        );
    }

    return (
        <div className="relative flex flex-col flex-1 min-h-0">
            <PopOutClassificationToolbar
                testIdPrefix="commit-popout"
                classification={classification}
                aiSelection={aiSelection}
                chatOpen={chat.chatOpen}
                onToggleChat={chat.toggleChat}
            />
            <PopOutReviewLayout
                workspaceId={workspaceId}
                files={fileList}
                model={model}
                progress={progress}
                classification={classification}
                fileCommentMap={fileCommentMap}
                renderDiff={filePath => (
                    <FileDiffPanel
                        key={`${commitHash}-${filePath}`}
                        workspaceId={workspaceId}
                        filePath={filePath}
                        source={createCommitDiffSource(workspaceId, commitHash, {
                            commit: commit ?? undefined,
                            files: filePaths,
                        })}
                        {...popOutDiffPanelProps(model, filePath, { progress, classification })}
                    />
                )}
                overview={(
                    <div className="flex flex-col items-center justify-center flex-1 gap-2 text-xs text-[#848484]">
                        {commit && (
                            <div className="text-center max-w-xs px-4">
                                <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#ccc] mb-1 break-words">{commit.subject}</div>
                                <div className="text-[10px] text-[#848484] mb-2">{commit.author} · {commit.hash.slice(0, 7)}</div>
                            </div>
                        )}
                        <span>Select a file to view its diff</span>
                        <span className="text-[10px]">{fileList.length} file{fileList.length !== 1 ? 's' : ''} changed</span>
                    </div>
                )}
                chatSidePanel={(
                    <PopOutReviewChatSidePanel
                        chat={chat}
                        containerTestId="commit-popout-chat-container"
                        framed={(
                            <CommitChatPlacementFrame
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
                                workspaceId={workspaceId}
                                commitHash={commitHash}
                                commitMessage={commit?.subject}
                                onClose={chat.closeChat}
                            />
                        )}
                    />
                )}
            />
            <PopOutReviewChatLens chat={chat}>
                <CommitChatPlacementFrame
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
