/**
 * useCrossFileNav — shared hook for cross-file hunk navigation.
 *
 * When the viewer is at a hunk boundary (last hunk for ▼, first hunk for ▲)
 * and a multi-file context is available, navigates to the adjacent file
 * instead of wrapping within the current file.
 */

import { useCallback } from 'react';
import type { UnifiedDiffViewerHandle } from '../diff/UnifiedDiffViewer';

export interface CrossFileNavOptions {
    /** Currently displayed file path. */
    filePath: string | undefined;
    /** Ordered list of file paths in the parent context (commit, branch, working tree). */
    files: string[];
    /** Ref to the diff viewer imperative handle. */
    viewerRef: React.RefObject<UnifiedDiffViewerHandle | null>;
    /** Callback invoked when cross-file navigation should occur. */
    onNavigateToFile?: (filePath: string, hunkTarget: 'first' | 'last') => void;
}

export interface CrossFileNavHandlers {
    handleNext: () => void;
    handlePrev: () => void;
}

/**
 * Returns next/prev handlers that perform cross-file navigation at
 * hunk boundaries and fall back to within-file hunk scrolling otherwise.
 */
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
        if (filePath && files.length > 1 && onNavigateToFile) {
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
        if (filePath && files.length > 1 && onNavigateToFile) {
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
