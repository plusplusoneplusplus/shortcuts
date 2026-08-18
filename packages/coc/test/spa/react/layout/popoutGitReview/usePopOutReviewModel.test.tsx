/**
 * Tests for the shared pop-out review model — the kernel that keeps commit, PR,
 * and branch-range file selection, hunk targeting, priority navigation, and
 * last-selected-file persistence identical.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
    popOutDiffPanelProps,
    usePopOutReviewModel,
} from '../../../../../src/server/spa/client/react/layout/popoutGitReview/usePopOutReviewModel';
import type { FileChange } from '../../../../../src/server/spa/client/react/features/git/diff/FileTree';
import type { UseClassificationReturn } from '../../../../../src/server/spa/client/react/features/git/diff/useClassification';
import type { UsePrReviewProgressReturn } from '../../../../../src/server/spa/client/react/features/git/diff/usePrReviewProgress';
import type { HunkCategory } from '../../../../../src/server/spa/client/react/features/pull-requests/classification-types';

const FILES: FileChange[] = [
    { path: 'src/mechanical.ts', status: 'modified', additions: 1, deletions: 1 },
    { path: 'src/logic.ts', status: 'modified', additions: 2, deletions: 0 },
];

function makeProgress(overrides: Partial<UsePrReviewProgressReturn> = {}): UsePrReviewProgressReturn {
    return {
        state: {
            reviewedFiles: new Set<string>(),
            visitedFiles: new Set<string>(),
            lastSelectedFile: null,
            hydrated: true,
        },
        isReviewed: vi.fn().mockReturnValue(false),
        isVisited: vi.fn().mockReturnValue(false),
        markVisited: vi.fn(),
        markReviewed: vi.fn(),
        unmarkReviewed: vi.fn(),
        toggleReviewed: vi.fn(),
        setLastSelectedFile: vi.fn(),
        ...overrides,
    } as UsePrReviewProgressReturn;
}

function makeClassification(
    status: 'idle' | 'loading' | 'ready',
    overrides: Partial<UseClassificationReturn> = {},
): UseClassificationReturn {
    return {
        state: {
            status,
            error: null,
            activeFilters: new Set<HunkCategory>(['logic', 'mechanical']),
        },
        classify: vi.fn(),
        toggleFilter: vi.fn(),
        setFilters: vi.fn(),
        getFileBadge: (path: string) => (
            path === 'src/logic.ts'
                ? { category: 'logic' as HunkCategory, intensity: 'high' as const }
                : { category: 'mechanical' as HunkCategory, intensity: 'low' as const }
        ),
        getHunkClassification: vi.fn(),
        isHunkDimmed: vi.fn().mockReturnValue(false),
        isFileDimmed: vi.fn().mockReturnValue(false),
        ...overrides,
    } as unknown as UseClassificationReturn;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('usePopOutReviewModel: file selection', () => {
    it('selects a file, marks it visited, and clears any hunk target', () => {
        const progress = makeProgress();
        const { result } = renderHook(() => usePopOutReviewModel({ files: FILES, progress }));

        act(() => result.current.handleNavigateToFile('src/logic.ts', 'last'));
        expect(result.current.hunkTarget).toBe('last');

        act(() => result.current.handleFileSelect('src/mechanical.ts'));
        expect(result.current.selectedFilePath).toBe('src/mechanical.ts');
        expect(result.current.hunkTarget).toBeUndefined();
        expect(progress.markVisited).toHaveBeenCalledWith('src/mechanical.ts');
    });

    it('toggles the selection off when the same file is clicked again', () => {
        const progress = makeProgress();
        const { result } = renderHook(() => usePopOutReviewModel({ files: FILES, progress }));

        act(() => result.current.handleFileSelect('src/logic.ts'));
        act(() => result.current.handleFileSelect('src/logic.ts'));

        expect(result.current.selectedFilePath).toBeNull();
        // Deselection is not a visit.
        expect(progress.markVisited).toHaveBeenCalledTimes(1);
    });

    it('clears selection and hunk target on back', () => {
        const { result } = renderHook(() => usePopOutReviewModel({ files: FILES }));

        act(() => result.current.handleNavigateToFile('src/logic.ts', 'first'));
        act(() => result.current.handleBack());

        expect(result.current.selectedFilePath).toBeNull();
        expect(result.current.hunkTarget).toBeUndefined();
    });

    it('works without review progress (branch-range) instead of crashing', () => {
        const { result } = renderHook(() => usePopOutReviewModel({ files: FILES }));

        act(() => result.current.handleFileSelect('src/logic.ts'));
        expect(result.current.selectedFilePath).toBe('src/logic.ts');
    });
});

describe('usePopOutReviewModel: last-selected-file sync', () => {
    it('reports the current selection to the progress hook', () => {
        const progress = makeProgress();
        const { result } = renderHook(() => usePopOutReviewModel({ files: FILES, progress }));

        expect(progress.setLastSelectedFile).toHaveBeenCalledWith(null);

        act(() => result.current.handleFileSelect('src/logic.ts'));
        expect(progress.setLastSelectedFile).toHaveBeenLastCalledWith('src/logic.ts');

        act(() => result.current.handleBack());
        expect(progress.setLastSelectedFile).toHaveBeenLastCalledWith(null);
    });
});

describe('usePopOutReviewModel: classification-driven controls', () => {
    it('reports classification as not ready until results land', () => {
        const { result } = renderHook(() => usePopOutReviewModel({
            files: FILES,
            classification: makeClassification('loading'),
        }));

        expect(result.current.classifyReady).toBe(false);
        expect(result.current.priorityNav).toEqual({ prevPath: null, nextPath: null });
    });

    it('offers priority navigation once classification is ready', () => {
        const progress = makeProgress();
        const { result } = renderHook(() => usePopOutReviewModel({
            files: FILES,
            progress,
            classification: makeClassification('ready'),
        }));

        expect(result.current.classifyReady).toBe(true);
        // High-intensity logic outranks mechanical regardless of list order.
        expect(result.current.priorityNav.nextPath).toBe('src/logic.ts');

        act(() => result.current.handleNextPriority());
        expect(result.current.selectedFilePath).toBe('src/logic.ts');
        expect(result.current.hunkTarget).toBe('first');
        expect(progress.markVisited).toHaveBeenCalledWith('src/logic.ts');

        act(() => result.current.handleNextPriority());
        expect(result.current.selectedFilePath).toBe('src/mechanical.ts');

        act(() => result.current.handlePrevPriority());
        expect(result.current.selectedFilePath).toBe('src/logic.ts');
    });

    it('leaves the selection alone when there is no priority candidate', () => {
        const { result } = renderHook(() => usePopOutReviewModel({
            files: [],
            classification: makeClassification('ready'),
        }));

        act(() => result.current.handleNextPriority());
        expect(result.current.selectedFilePath).toBeNull();
    });

    it('toggles priority sort', () => {
        const { result } = renderHook(() => usePopOutReviewModel({ files: FILES }));

        expect(result.current.prioritySort).toBe(false);
        act(() => result.current.handleTogglePrioritySort());
        expect(result.current.prioritySort).toBe(true);
    });

    it('restores every category on Show all', () => {
        const classification = makeClassification('ready');
        const { result } = renderHook(() => usePopOutReviewModel({ files: FILES, classification }));

        act(() => result.current.handleShowAll());

        const applied = (classification.setFilters as ReturnType<typeof vi.fn>).mock.calls[0][0] as Set<HunkCategory>;
        expect(applied.has('logic')).toBe(true);
        expect(applied.has('generated')).toBe(true);
    });

    it('is inert on Show all when the review has no classification', () => {
        const { result } = renderHook(() => usePopOutReviewModel({ files: FILES }));
        expect(() => act(() => result.current.handleShowAll())).not.toThrow();
    });
});

describe('popOutDiffPanelProps', () => {
    it('wires reviewed state and hunk classification when both are available', () => {
        const progress = makeProgress({ isReviewed: vi.fn().mockReturnValue(true) });
        const classification = makeClassification('ready');
        const { result } = renderHook(() => usePopOutReviewModel({ files: FILES, progress, classification }));

        const props = popOutDiffPanelProps(result.current, 'src/logic.ts', { progress, classification });
        expect(props.backLabel).toBe('All files');
        expect(props.isReviewed).toBe(true);
        expect(props.getHunkClassification).toBe(classification.getHunkClassification);
        expect(props.hunkActiveFilters).toBe(classification.state.activeFilters);

        props.onToggleReviewed?.();
        expect(progress.toggleReviewed).toHaveBeenCalledWith('src/logic.ts');
    });

    it('omits classification props until results are ready', () => {
        const progress = makeProgress();
        const classification = makeClassification('idle');
        const { result } = renderHook(() => usePopOutReviewModel({ files: FILES, progress, classification }));

        const props = popOutDiffPanelProps(result.current, 'src/logic.ts', { progress, classification });
        expect(props.getHunkClassification).toBeUndefined();
        expect(props.hunkActiveFilters).toBeUndefined();
    });

    it('omits reviewed props for review types without progress', () => {
        const { result } = renderHook(() => usePopOutReviewModel({ files: FILES }));

        const props = popOutDiffPanelProps(result.current, 'src/logic.ts');
        expect(props.isReviewed).toBeUndefined();
        expect(props.onToggleReviewed).toBeUndefined();
    });
});
