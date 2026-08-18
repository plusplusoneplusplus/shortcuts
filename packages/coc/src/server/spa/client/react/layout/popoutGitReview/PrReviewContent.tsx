/**
 * PR adapter for the pop-out review kernel.
 *
 * Loads the PR and its diff, then configures the shared toolbar, review model,
 * and layout. Unlike commit review, PR progress is persisted per
 * (originId, workspaceId, repoId, prId) and keyed by head SHA.
 */

import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '../../ui';
import { getCocClientForWorkspace } from '../../repos/cloneRegistry';
import { resolveCanonicalOriginId } from '../../repos/originScope';
import { PrChatPanel } from '../../features/git/commits/PrChatPanel';
import { ReviewChatPlacementFrame } from '../../features/git/reviewChat/ReviewChatPlacementFrame';
import { FileDiffPanel } from '../../features/git/diff/FileDiffPanel';
import { createPrDiffSource } from '../../features/git/diff/diffSource';
import { parseDiffFileList } from '../../features/git/diff/UnifiedDiffViewer';
import { useReviewChatPresentation } from '../../features/git/hooks/useReviewChatPresentation';
import { useClassification } from '../../features/git/diff/useClassification';
import { usePrReviewProgress } from '../../features/git/diff/usePrReviewProgress';
import { useModalJobAiSelection } from '../../shared/ModalJobAiControls';
import { PopOutClassificationToolbar } from './PopOutClassificationToolbar';
import { PopOutReviewLayout } from './PopOutReviewLayout';
import { PopOutReviewChatLens, PopOutReviewChatSidePanel } from './PopOutReviewChatSlot';
import { popOutDiffPanelProps, usePopOutReviewModel } from './usePopOutReviewModel';
import type { ClassificationKey } from '../../features/git/diff/diffSource';
import type { FileChange } from '../../features/git/diff/FileTree';
import type { ReviewChatTarget } from '../../features/git/commits/commitChatPlacement';

export interface PrReviewContentProps {
    workspaceId: string;
    repoId: string;
    prId: string;
    originId?: string;
    onTitleLoaded?: (title: string) => void;
}

export function PrReviewContent({ workspaceId, repoId, prId, originId, onTitleLoaded }: PrReviewContentProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [fileList, setFileList] = useState<FileChange[]>([]);
    const [prTitle, setPrTitle] = useState<string | undefined>(undefined);
    const [headSha, setHeadSha] = useState<string | undefined>(undefined);

    const prChatTarget = useMemo<ReviewChatTarget>(() => ({
        type: 'pr',
        workspaceId,
        repoId,
        prId,
        headSha,
    }), [workspaceId, repoId, prId, headSha]);
    const chat = useReviewChatPresentation({ target: prChatTarget });

    const progressOriginId = useMemo(
        () => originId ?? resolveCanonicalOriginId({ workspaceId }),
        [originId, workspaceId],
    );
    // Classification hook for PR diff
    const classificationKey: ClassificationKey | undefined =
        headSha ? { type: 'pr', repoId, originId: progressOriginId, workspaceId, identifier: `${prId}:${headSha}` } : undefined;
    const aiSelection = useModalJobAiSelection({ workspaceId, mode: 'ask' });
    const classification = useClassification(classificationKey, aiSelection.resolved, { workspaceId });
    const progress = usePrReviewProgress(headSha, {
        persistence: { originId: progressOriginId, workspaceId, repoId, prId },
    });

    const model = usePopOutReviewModel({ files: fileList, progress, classification });

    useEffect(() => {
        setLoading(true);
        setError(null);
        const client = getCocClientForWorkspace(workspaceId);

        Promise.all([
            client.pullRequests.getForOrigin(progressOriginId, prId, { workspaceId, repoId }) as Promise<{ title?: string; headSha?: string }>,
            client.pullRequests.getDiffForOrigin(progressOriginId, prId, { workspaceId, repoId }),
        ])
            .then(([prData, diffText]) => {
                setPrTitle(prData.title);
                if (prData.title) onTitleLoaded?.(prData.title);
                setHeadSha(prData.headSha);
                // Parse with the same helper the inline Files tab uses so the
                // pop-out list shows real Added/Deleted/Renamed statuses.
                setFileList(parseDiffFileList(diffText));
            })
            .catch((err: Error) => setError(err.message))
            .finally(() => setLoading(false));
    }, [repoId, prId, progressOriginId, workspaceId]);

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

    const chatPanel = (hideEmptyHeader: boolean) => (
        <PrChatPanel
            workspaceId={workspaceId}
            prId={prId}
            filePath={model.selectedFilePath ?? undefined}
            repoId={repoId}
            prTitle={prTitle}
            onClose={chat.closeChat}
            hideEmptyHeader={hideEmptyHeader}
        />
    );

    return (
        <div className="flex flex-col flex-1 min-h-0">
            <PopOutClassificationToolbar
                testIdPrefix="pr-popout"
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
                renderDiff={filePath => (
                    <FileDiffPanel
                        key={`pr-${prId}-${filePath}`}
                        workspaceId={workspaceId}
                        filePath={filePath}
                        source={createPrDiffSource(workspaceId, repoId, prId, {
                            originId: progressOriginId,
                            headSha,
                            files: filePaths,
                            title: prTitle,
                        })}
                        showSourceLabel={false}
                        {...popOutDiffPanelProps(model, filePath, { progress, classification })}
                    />
                )}
                overview={(
                    <div className="flex flex-col items-center justify-center flex-1 gap-2 text-xs text-[#848484]">
                        <span>Select a file to view its diff</span>
                        <span className="text-[10px]">{fileList.length} file{fileList.length !== 1 ? 's' : ''} changed</span>
                    </div>
                )}
                chatSidePanel={(
                    <PopOutReviewChatSidePanel
                        chat={chat}
                        containerTestId="pr-popout-chat-container"
                        framed={(
                            <ReviewChatPlacementFrame
                                title="PR Chat"
                                identifier={`#${prId}`}
                                presentation="side-panel"
                                onClose={chat.closeChat}
                                onUnpin={chat.unpinChat}
                                testIdPrefix="pr-chat"
                            >
                                {chatPanel(true)}
                            </ReviewChatPlacementFrame>
                        )}
                        plain={chatPanel(false)}
                    />
                )}
            />
            <PopOutReviewChatLens chat={chat}>
                <ReviewChatPlacementFrame
                    title="PR Chat"
                    identifier={`#${prId}`}
                    presentation="lens"
                    onClose={chat.closeChat}
                    isMinimized={chat.isMinimized}
                    onMinimize={chat.minimizeChat}
                    onRestore={chat.restoreChat}
                    onPin={chat.pinChat}
                    testIdPrefix="pr-chat"
                >
                    {chatPanel(true)}
                </ReviewChatPlacementFrame>
            </PopOutReviewChatLens>
        </div>
    );
}
