/**
 * Tests for the useCrossFileNav hook — cross-file hunk navigation.
 *
 * Covers boundary detection, wrap-around, single-file fallback,
 * and no-op when onNavigateToFile is not provided.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCrossFileNav } from '../../../../src/server/spa/client/react/repos/useCrossFileNav';
import type { UnifiedDiffViewerHandle } from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';

function createMockViewer(overrides: Partial<UnifiedDiffViewerHandle> = {}): React.RefObject<UnifiedDiffViewerHandle> {
    const handle: UnifiedDiffViewerHandle = {
        scrollToNextHunk: vi.fn(),
        scrollToPrevHunk: vi.fn(),
        getHunkCount: vi.fn(() => 3),
        getCurrentHunkIndex: vi.fn(() => -1),
        scrollToHunk: vi.fn(),
        ...overrides,
    };
    return { current: handle } as React.RefObject<UnifiedDiffViewerHandle>;
}

// ============================================================================
// handleNext — cross-file forward navigation
// ============================================================================

describe('useCrossFileNav — handleNext', () => {
    it('calls scrollToNextHunk for normal within-file navigation', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 3),
            getCurrentHunkIndex: vi.fn(() => 0),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'a.ts', files: ['a.ts', 'b.ts', 'c.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handleNext();
        expect(viewerRef.current!.scrollToNextHunk).toHaveBeenCalled();
        expect(onNavigateToFile).not.toHaveBeenCalled();
    });

    it('navigates to next file when at last hunk', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 3),
            getCurrentHunkIndex: vi.fn(() => 2),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'a.ts', files: ['a.ts', 'b.ts', 'c.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handleNext();
        expect(onNavigateToFile).toHaveBeenCalledWith('b.ts', 'first');
        expect(viewerRef.current!.scrollToNextHunk).not.toHaveBeenCalled();
    });

    it('wraps from last file to first file', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 2),
            getCurrentHunkIndex: vi.fn(() => 1),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'c.ts', files: ['a.ts', 'b.ts', 'c.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handleNext();
        expect(onNavigateToFile).toHaveBeenCalledWith('a.ts', 'first');
    });

    it('navigates to next file when current has no hunks', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 0),
            getCurrentHunkIndex: vi.fn(() => -1),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'a.ts', files: ['a.ts', 'b.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handleNext();
        expect(onNavigateToFile).toHaveBeenCalledWith('b.ts', 'first');
    });

    it('falls back to scrollToNextHunk for single-file list', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 2),
            getCurrentHunkIndex: vi.fn(() => 1),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'a.ts', files: ['a.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handleNext();
        expect(viewerRef.current!.scrollToNextHunk).toHaveBeenCalled();
        expect(onNavigateToFile).not.toHaveBeenCalled();
    });

    it('falls back to scrollToNextHunk when no onNavigateToFile', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 2),
            getCurrentHunkIndex: vi.fn(() => 1),
        });
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'a.ts', files: ['a.ts', 'b.ts'], viewerRef }),
        );
        result.current.handleNext();
        expect(viewerRef.current!.scrollToNextHunk).toHaveBeenCalled();
    });

    it('falls back to scrollToNextHunk when filePath is undefined', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 2),
            getCurrentHunkIndex: vi.fn(() => 1),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: undefined, files: ['a.ts', 'b.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handleNext();
        expect(viewerRef.current!.scrollToNextHunk).toHaveBeenCalled();
        expect(onNavigateToFile).not.toHaveBeenCalled();
    });

    it('falls back to scrollToNextHunk when files array is empty', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 2),
            getCurrentHunkIndex: vi.fn(() => 1),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'a.ts', files: [], viewerRef, onNavigateToFile }),
        );
        result.current.handleNext();
        expect(viewerRef.current!.scrollToNextHunk).toHaveBeenCalled();
    });

    it('falls back to scrollToNextHunk when filePath not found in files list', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 2),
            getCurrentHunkIndex: vi.fn(() => 1),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'unknown.ts', files: ['a.ts', 'b.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handleNext();
        expect(viewerRef.current!.scrollToNextHunk).toHaveBeenCalled();
    });

    it('does nothing when viewerRef is null', () => {
        const viewerRef = { current: null } as React.RefObject<UnifiedDiffViewerHandle | null>;
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'a.ts', files: ['a.ts', 'b.ts'], viewerRef, onNavigateToFile }),
        );
        expect(() => result.current.handleNext()).not.toThrow();
        expect(onNavigateToFile).not.toHaveBeenCalled();
    });

    it('does not navigate when index is -1 (not yet navigated) even with multiple files', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 3),
            getCurrentHunkIndex: vi.fn(() => -1),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'a.ts', files: ['a.ts', 'b.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handleNext();
        expect(viewerRef.current!.scrollToNextHunk).toHaveBeenCalled();
        expect(onNavigateToFile).not.toHaveBeenCalled();
    });
});

// ============================================================================
// handlePrev — cross-file backward navigation
// ============================================================================

describe('useCrossFileNav — handlePrev', () => {
    it('calls scrollToPrevHunk for normal within-file navigation', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 3),
            getCurrentHunkIndex: vi.fn(() => 2),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'b.ts', files: ['a.ts', 'b.ts', 'c.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handlePrev();
        expect(viewerRef.current!.scrollToPrevHunk).toHaveBeenCalled();
        expect(onNavigateToFile).not.toHaveBeenCalled();
    });

    it('navigates to previous file when at first hunk', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 3),
            getCurrentHunkIndex: vi.fn(() => 0),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'b.ts', files: ['a.ts', 'b.ts', 'c.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handlePrev();
        expect(onNavigateToFile).toHaveBeenCalledWith('a.ts', 'last');
        expect(viewerRef.current!.scrollToPrevHunk).not.toHaveBeenCalled();
    });

    it('wraps from first file to last file', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 2),
            getCurrentHunkIndex: vi.fn(() => 0),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'a.ts', files: ['a.ts', 'b.ts', 'c.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handlePrev();
        expect(onNavigateToFile).toHaveBeenCalledWith('c.ts', 'last');
    });

    it('navigates to previous file when current has no hunks', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 0),
            getCurrentHunkIndex: vi.fn(() => -1),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'b.ts', files: ['a.ts', 'b.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handlePrev();
        expect(onNavigateToFile).toHaveBeenCalledWith('a.ts', 'last');
    });

    it('falls back to scrollToPrevHunk for single-file list', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 2),
            getCurrentHunkIndex: vi.fn(() => 0),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'a.ts', files: ['a.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handlePrev();
        expect(viewerRef.current!.scrollToPrevHunk).toHaveBeenCalled();
        expect(onNavigateToFile).not.toHaveBeenCalled();
    });

    it('falls back to scrollToPrevHunk when index is -1 with hunks available', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 3),
            getCurrentHunkIndex: vi.fn(() => -1),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'b.ts', files: ['a.ts', 'b.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handlePrev();
        expect(viewerRef.current!.scrollToPrevHunk).toHaveBeenCalled();
        expect(onNavigateToFile).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Edge cases — two-file list
// ============================================================================

describe('useCrossFileNav — two-file list', () => {
    it('next at boundary navigates from first to second file', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 1),
            getCurrentHunkIndex: vi.fn(() => 0),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'a.ts', files: ['a.ts', 'b.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handleNext();
        expect(onNavigateToFile).toHaveBeenCalledWith('b.ts', 'first');
    });

    it('prev at boundary navigates from second to first file', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 1),
            getCurrentHunkIndex: vi.fn(() => 0),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'b.ts', files: ['a.ts', 'b.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handlePrev();
        expect(onNavigateToFile).toHaveBeenCalledWith('a.ts', 'last');
    });

    it('next at last file wraps to first', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 1),
            getCurrentHunkIndex: vi.fn(() => 0),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'b.ts', files: ['a.ts', 'b.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handleNext();
        expect(onNavigateToFile).toHaveBeenCalledWith('a.ts', 'first');
    });

    it('prev at first file wraps to last', () => {
        const viewerRef = createMockViewer({
            getHunkCount: vi.fn(() => 1),
            getCurrentHunkIndex: vi.fn(() => 0),
        });
        const onNavigateToFile = vi.fn();
        const { result } = renderHook(() =>
            useCrossFileNav({ filePath: 'a.ts', files: ['a.ts', 'b.ts'], viewerRef, onNavigateToFile }),
        );
        result.current.handlePrev();
        expect(onNavigateToFile).toHaveBeenCalledWith('b.ts', 'last');
    });
});
