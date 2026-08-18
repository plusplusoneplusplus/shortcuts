/**
 * Shared review model for the pop-out git review flows.
 *
 * Owns the interaction state every review type needs — selected file, hunk
 * target, priority sort, classification-driven prev/next navigation, and the
 * last-selected-file sync — so commit, PR, and branch-range pop-outs cannot
 * drift from each other.
 *
 * `progress` and `classification` are optional: a review type that has not
 * opted into review progress or hunk classification simply gets the inert
 * behavior (no visited marking, no priority navigation).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { pickPriorityFile } from '../../features/git/diff/prPopoutPriority';
import { HUNK_CATEGORIES } from '../../features/pull-requests/classification-types';
import type { HunkCategory } from '../../features/pull-requests/classification-types';
import type { FileChange } from '../../features/git/diff/FileTree';
import type { UseClassificationReturn } from '../../features/git/diff/useClassification';
import type { UsePrReviewProgressReturn } from '../../features/git/diff/usePrReviewProgress';

export type PopOutHunkTarget = 'first' | 'last' | undefined;

export interface UsePopOutReviewModelOptions {
    /** Files currently listed in the rail, in display order. */
    files: FileChange[];
    progress?: UsePrReviewProgressReturn;
    classification?: UseClassificationReturn;
}

export interface PopOutPriorityNav {
    prevPath: string | null;
    nextPath: string | null;
}

export interface PopOutReviewModel {
    selectedFilePath: string | null;
    hunkTarget: PopOutHunkTarget;
    prioritySort: boolean;
    /** True once classification results are available for this review. */
    classifyReady: boolean;
    priorityNav: PopOutPriorityNav;
    handleFileSelect: (filePath: string) => void;
    handleNavigateToFile: (filePath: string, target: 'first' | 'last') => void;
    handleBack: () => void;
    handleTogglePrioritySort: () => void;
    handleShowAll: () => void;
    handlePrevPriority: () => void;
    handleNextPriority: () => void;
}

export function usePopOutReviewModel({
    files,
    progress,
    classification,
}: UsePopOutReviewModelOptions): PopOutReviewModel {
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
    const [hunkTarget, setHunkTarget] = useState<PopOutHunkTarget>(undefined);
    const [prioritySort, setPrioritySort] = useState(false);

    const markVisited = useCallback((filePath: string) => {
        progress?.markVisited(filePath);
    }, [progress]);

    const handleFileSelect = useCallback((filePath: string) => {
        setHunkTarget(undefined);
        setSelectedFilePath(prev => {
            const next = prev === filePath ? null : filePath;
            if (next) markVisited(next);
            return next;
        });
    }, [markVisited]);

    const handleNavigateToFile = useCallback((filePath: string, target: 'first' | 'last') => {
        setSelectedFilePath(filePath);
        setHunkTarget(target);
        markVisited(filePath);
    }, [markVisited]);

    const handleBack = useCallback(() => {
        setSelectedFilePath(null);
        setHunkTarget(undefined);
    }, []);

    const handleTogglePrioritySort = useCallback(() => {
        setPrioritySort(prev => !prev);
    }, []);

    const setFilters = classification?.setFilters;
    const handleShowAll = useCallback(() => {
        setFilters?.(new Set<HunkCategory>(HUNK_CATEGORIES));
    }, [setFilters]);

    const classifyReady = classification?.state.status === 'ready';
    const getFileBadge = classification?.getFileBadge;
    const activeFilters = classification?.state.activeFilters;
    const reviewedFiles = progress?.state.reviewedFiles;

    const priorityNav = useMemo<PopOutPriorityNav>(() => {
        if (!classifyReady || !getFileBadge) {
            return { prevPath: null, nextPath: null };
        }
        const ctx = { getFileBadge, reviewedFiles };
        const next = pickPriorityFile(files, ctx, {
            currentPath: selectedFilePath,
            direction: 'next',
            activeFilters,
        });
        const prev = pickPriorityFile(files, ctx, {
            currentPath: selectedFilePath,
            direction: 'prev',
            activeFilters,
        });
        return { prevPath: prev.path, nextPath: next.path };
    }, [classifyReady, getFileBadge, activeFilters, reviewedFiles, files, selectedFilePath]);

    const jumpToPriority = useCallback((path: string | null) => {
        if (!path) return;
        setSelectedFilePath(path);
        setHunkTarget('first');
        markVisited(path);
    }, [markVisited]);

    const handleNextPriority = useCallback(() => {
        jumpToPriority(priorityNav.nextPath);
    }, [jumpToPriority, priorityNav.nextPath]);

    const handlePrevPriority = useCallback(() => {
        jumpToPriority(priorityNav.prevPath);
    }, [jumpToPriority, priorityNav.prevPath]);

    // Sync the current selection into the progress snapshot so reloads remember
    // which file the reviewer was on (session-local for commits, persisted for PRs).
    const setLastSelectedFile = progress?.setLastSelectedFile;
    useEffect(() => {
        setLastSelectedFile?.(selectedFilePath);
    }, [selectedFilePath, setLastSelectedFile]);

    return {
        selectedFilePath,
        hunkTarget,
        prioritySort,
        classifyReady,
        priorityNav,
        handleFileSelect,
        handleNavigateToFile,
        handleBack,
        handleTogglePrioritySort,
        handleShowAll,
        handlePrevPriority,
        handleNextPriority,
    };
}

export interface PopOutDiffPanelProps {
    onNavigateToFile: (filePath: string, target: 'first' | 'last') => void;
    initialHunkTarget: PopOutHunkTarget;
    onBack: () => void;
    backLabel: string;
    isReviewed?: boolean;
    onToggleReviewed?: () => void;
    getHunkClassification?: UseClassificationReturn['getHunkClassification'];
    hunkActiveFilters?: Set<HunkCategory>;
}

/**
 * FileDiffPanel props every pop-out review type shares, so reviewed toggles and
 * hunk classification wiring stay identical across commit, PR, and branch-range.
 */
export function popOutDiffPanelProps(
    model: PopOutReviewModel,
    filePath: string,
    options: { progress?: UsePrReviewProgressReturn; classification?: UseClassificationReturn } = {},
): PopOutDiffPanelProps {
    const { progress, classification } = options;
    return {
        onNavigateToFile: model.handleNavigateToFile,
        initialHunkTarget: model.hunkTarget,
        onBack: model.handleBack,
        backLabel: 'All files',
        isReviewed: progress ? progress.isReviewed(filePath) : undefined,
        onToggleReviewed: progress ? () => progress.toggleReviewed(filePath) : undefined,
        getHunkClassification: model.classifyReady ? classification?.getHunkClassification : undefined,
        hunkActiveFilters: model.classifyReady ? classification?.state.activeFilters : undefined,
    };
}
