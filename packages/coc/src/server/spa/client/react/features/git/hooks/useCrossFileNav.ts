/**
 * useCrossFileNav — shared hook for cross-file hunk navigation.
 *
 * When the viewer is at a hunk boundary (last hunk for ▼, first hunk for ▲)
 * and a multi-file context is available, navigates to the adjacent file
 * instead of wrapping within the current file.
 */

import { useCallback } from 'react';
import type { UnifiedDiffViewerHandle } from '../diff/UnifiedDiffViewer';

/** The part of a viewer handle cross-file navigation drives. */
export type HunkNavigationHandle = Pick<
    UnifiedDiffViewerHandle,
    'scrollToNextHunk' | 'scrollToPrevHunk' | 'getHunkCount' | 'getCurrentHunkIndex' | 'isHunkNavigationReady'
>;

/**
 * A viewer still computing its hunks reports zero of them; treating that as a
 * boundary would skip the whole file. Such a viewer holds the request instead.
 */
function hunksPending(viewer: HunkNavigationHandle): boolean {
    return viewer.isHunkNavigationReady?.() === false;
}

export interface CrossFileNavOptions {
    filePath: string | undefined;
    /** Ordered list of file paths in the parent context (commit, branch, working tree). */
    files: string[];
    viewerRef: React.RefObject<HunkNavigationHandle | null>;
    onNavigateToFile?: (filePath: string, hunkTarget: 'first' | 'last') => void;
}

export interface CrossFileNavHandlers {
    handleNext: () => void;
    handlePrev: () => void;
}

export function useCrossFileNav({
    filePath,
    files,
    viewerRef,
    onNavigateToFile,
}: CrossFileNavOptions): CrossFileNavHandlers {
    const handleNext = useCallback(() => {
        const viewer = viewerRef.current;
        if (!viewer) return;

        const count = viewer.getHunkCount();
        const current = viewer.getCurrentHunkIndex();

        // Cross-file: at last hunk (or no hunks) with multiple files
        if (!hunksPending(viewer) && filePath && files.length > 1 && onNavigateToFile) {
            const atBoundary = count === 0 || (current >= 0 && current === count - 1);
            if (atBoundary) {
                const currentIdx = files.indexOf(filePath);
                if (currentIdx >= 0) {
                    const nextIdx = (currentIdx + 1) % files.length;
                    onNavigateToFile(files[nextIdx], 'first');
                    return;
                }
            }
        }

        // Within-file navigation (wraps for single-file)
        viewer.scrollToNextHunk();
    }, [filePath, files, viewerRef, onNavigateToFile]);

    const handlePrev = useCallback(() => {
        const viewer = viewerRef.current;
        if (!viewer) return;

        const count = viewer.getHunkCount();
        const current = viewer.getCurrentHunkIndex();

        // Cross-file: at first hunk (or no hunks) with multiple files
        if (!hunksPending(viewer) && filePath && files.length > 1 && onNavigateToFile) {
            const atBoundary = count === 0 || current === 0;
            if (atBoundary) {
                const currentIdx = files.indexOf(filePath);
                if (currentIdx >= 0) {
                    const prevIdx = (currentIdx - 1 + files.length) % files.length;
                    onNavigateToFile(files[prevIdx], 'last');
                    return;
                }
            }
        }

        // Within-file navigation (wraps for single-file)
        viewer.scrollToPrevHunk();
    }, [filePath, files, viewerRef, onNavigateToFile]);

    return { handleNext, handlePrev };
}
