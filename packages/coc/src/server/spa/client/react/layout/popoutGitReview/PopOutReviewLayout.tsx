/**
 * File rail + diff/overview column + chat column, shared by every pop-out
 * review type.
 *
 * Review-type specifics stay in the adapters: they hand in the diff renderer,
 * the "nothing selected" overview, and the chat side panel. Everything the
 * rail needs — classification dimming/badges, priority sort and navigation,
 * reviewed/visited state — is derived from the shared review model here so it
 * cannot diverge between commit, PR, and branch-range.
 */

import type { ReactNode } from 'react';
import { PopOutFilePanel } from '../../features/git/diff/PopOutFilePanel';
import type { FileChange } from '../../features/git/diff/FileTree';
import type { UseClassificationReturn } from '../../features/git/diff/useClassification';
import type { UsePrReviewProgressReturn } from '../../features/git/diff/usePrReviewProgress';
import type { PopOutReviewModel } from './usePopOutReviewModel';

export interface PopOutReviewLayoutProps {
    workspaceId: string;
    files: FileChange[];
    model: PopOutReviewModel;
    progress?: UsePrReviewProgressReturn;
    classification?: UseClassificationReturn;
    fileCommentMap?: Map<string, number>;
    /** Diff surface for the selected file. */
    renderDiff: (filePath: string) => ReactNode;
    /** Shown when no file is selected. */
    overview: ReactNode;
    chatSidePanel?: ReactNode;
}

export function PopOutReviewLayout({
    workspaceId,
    files,
    model,
    progress,
    classification,
    fileCommentMap,
    renderDiff,
    overview,
    chatSidePanel,
}: PopOutReviewLayoutProps) {
    const classifyReady = model.classifyReady;

    return (
        <div className="flex flex-1 min-h-0">
            <PopOutFilePanel
                workspaceId={workspaceId}
                files={files}
                selectedFilePath={model.selectedFilePath}
                onFileSelect={model.handleFileSelect}
                fileCommentMap={fileCommentMap}
                isFileDimmed={classifyReady ? classification?.isFileDimmed : undefined}
                getFileBadge={classifyReady ? classification?.getFileBadge : undefined}
                prioritySort={model.prioritySort}
                onTogglePrioritySort={classifyReady ? model.handleTogglePrioritySort : undefined}
                activeFilters={classifyReady ? classification?.state.activeFilters : undefined}
                onShowAll={classifyReady ? model.handleShowAll : undefined}
                reviewedFiles={progress?.state.reviewedFiles}
                visitedFiles={progress?.state.visitedFiles}
                onPrevPriorityFile={classifyReady ? model.handlePrevPriority : undefined}
                onNextPriorityFile={classifyReady ? model.handleNextPriority : undefined}
                prevPriorityDisabled={model.priorityNav.prevPath === null}
                nextPriorityDisabled={model.priorityNav.nextPath === null}
            />
            <div className="flex-1 min-w-0 overflow-hidden">
                {model.selectedFilePath ? renderDiff(model.selectedFilePath) : overview}
            </div>
            {chatSidePanel}
        </div>
    );
}
