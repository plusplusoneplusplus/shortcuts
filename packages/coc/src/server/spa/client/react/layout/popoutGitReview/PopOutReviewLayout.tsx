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

import { useRef, type ReactNode } from 'react';
import { PopOutFilePanel } from '../../features/git/diff/PopOutFilePanel';
import type { FileChange } from '../../features/git/diff/FileTree';
import type { UseClassificationReturn } from '../../features/git/diff/useClassification';
import type { UsePrReviewProgressReturn } from '../../features/git/diff/usePrReviewProgress';
import type { PopOutReviewModel } from './usePopOutReviewModel';
import type { ReviewContentSearchPanelProps } from '../../features/git/diff/ReviewContentSearchPanel';
import { useDiffContentSearchEnabled } from '../../hooks/feature-flags/useDiffContentSearchEnabled';
import { REVIEW_SEARCH_OPEN_EVENT, useReviewContentSearchShortcut } from '../../features/git/diff/useReviewContentSearchShortcut';

export interface PopOutReviewLayoutProps {
    identity?: string;
    contentSearch?: Omit<ReviewContentSearchPanelProps, 'inputRef'>;
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
    identity, contentSearch,
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
    const rootRef = useRef<HTMLDivElement>(null);
    const canSearch = useDiffContentSearchEnabled() && !!contentSearch;
    useReviewContentSearchShortcut(rootRef, canSearch, () => rootRef.current?.dispatchEvent(new Event(REVIEW_SEARCH_OPEN_EVENT)));

    return (
        <div ref={rootRef} className="flex flex-1 min-h-0" data-review-content-search={canSearch ? 'true' : undefined}>
            <PopOutFilePanel
                key={identity}
                identity={identity}
                contentSearch={contentSearch}
                workspaceId={workspaceId}
                onDisplayOrderChange={model.setDisplayedPaths}
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
