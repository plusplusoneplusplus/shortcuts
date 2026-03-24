/**
 * Tests for the new UnifiedDiffViewerHandle methods: getCurrentHunkIndex and scrollToHunk.
 * Covers both UnifiedDiffViewer and SideBySideDiffViewer implementations.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React, { createRef } from 'react';
import { UnifiedDiffViewer } from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';
import type { UnifiedDiffViewerHandle } from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';
import { SideBySideDiffViewer } from '../../../../src/server/spa/client/react/repos/SideBySideDiffViewer';

const MULTI_HUNK_DIFF = `diff --git a/foo.ts b/foo.ts
index 0000000..1111111 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
-old line 1
+new line 1
 context
@@ -10,3 +10,3 @@
-old line 10
+new line 10
 context2
@@ -20,2 +20,2 @@
-old line 20
+new line 20`;

const SINGLE_HUNK_DIFF = `@@ -1,2 +1,2 @@
-old
+new`;

const NO_HUNK_DIFF = `diff --git a/foo.ts b/foo.ts
index 0000000..1111111 100644`;

function setupScrollParent(container: HTMLElement, testId: string) {
    const viewer = container.querySelector(`[data-testid="${testId}"]`)!;
    const scrollParent = viewer.parentElement!;
    scrollParent.style.overflowY = 'auto';
    Object.defineProperty(scrollParent, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(scrollParent, 'scrollTop', { value: 0, configurable: true });
    vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue({
        top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON() {},
    });
    const edits = container.querySelectorAll('[data-edit-start]');
    for (let i = 0; i < edits.length; i++) {
        const top = (i + 1) * 100;
        vi.spyOn(edits[i] as HTMLElement, 'getBoundingClientRect').mockReturnValue({
            top, bottom: top + 20, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
        });
    }
    scrollParent.scrollTo = vi.fn();
    return { scrollParent, edits };
}

// ============================================================================
// getCurrentHunkIndex — UnifiedDiffViewer
// ============================================================================

describe('UnifiedDiffViewer — getCurrentHunkIndex', () => {
    afterEach(() => vi.restoreAllMocks());

    it('returns -1 before any navigation', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />);
        expect(ref.current?.getCurrentHunkIndex()).toBe(-1);
    });

    it('returns 0 after first scrollToNextHunk call', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(<UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />);
        setupScrollParent(container, 'diff');
        ref.current?.scrollToNextHunk();
        expect(ref.current?.getCurrentHunkIndex()).toBe(0);
    });

    it('advances to 1 after second scrollToNextHunk call', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(<UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />);
        setupScrollParent(container, 'diff');
        ref.current?.scrollToNextHunk();
        ref.current?.scrollToNextHunk();
        expect(ref.current?.getCurrentHunkIndex()).toBe(1);
    });

    it('returns last index after scrollToPrevHunk from initial state', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(<UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />);
        setupScrollParent(container, 'diff');
        ref.current?.scrollToPrevHunk();
        expect(ref.current?.getCurrentHunkIndex()).toBe(2);
    });

    it('wraps to 0 when advancing past the last hunk', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(<UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />);
        setupScrollParent(container, 'diff');
        ref.current?.scrollToNextHunk(); // 0
        ref.current?.scrollToNextHunk(); // 1
        ref.current?.scrollToNextHunk(); // 2
        ref.current?.scrollToNextHunk(); // wraps to 0
        expect(ref.current?.getCurrentHunkIndex()).toBe(0);
    });

    it('returns -1 for diff with no edits', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<UnifiedDiffViewer ref={ref} diff={NO_HUNK_DIFF} data-testid="diff" />);
        expect(ref.current?.getCurrentHunkIndex()).toBe(-1);
    });

    it('resets to -1 when diff changes', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container, rerender } = render(<UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />);
        setupScrollParent(container, 'diff');
        ref.current?.scrollToNextHunk();
        expect(ref.current?.getCurrentHunkIndex()).toBe(0);
        rerender(<UnifiedDiffViewer ref={ref} diff={SINGLE_HUNK_DIFF} data-testid="diff" />);
        expect(ref.current?.getCurrentHunkIndex()).toBe(-1);
    });
});

// ============================================================================
// scrollToHunk — UnifiedDiffViewer
// ============================================================================

describe('UnifiedDiffViewer — scrollToHunk', () => {
    afterEach(() => vi.restoreAllMocks());

    it('scrolls to the specified hunk index', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(<UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />);
        const { scrollParent } = setupScrollParent(container, 'diff');
        ref.current?.scrollToHunk(1);
        expect(scrollParent.scrollTo).toHaveBeenCalled();
        expect(ref.current?.getCurrentHunkIndex()).toBe(1);
    });

    it('scrolls to the first hunk (index 0)', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(<UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />);
        const { scrollParent } = setupScrollParent(container, 'diff');
        ref.current?.scrollToHunk(0);
        expect(scrollParent.scrollTo).toHaveBeenCalledWith(
            expect.objectContaining({ top: 100 - 0 - 200 })
        );
        expect(ref.current?.getCurrentHunkIndex()).toBe(0);
    });

    it('scrolls to the last hunk', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(<UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />);
        const { scrollParent } = setupScrollParent(container, 'diff');
        ref.current?.scrollToHunk(2);
        expect(scrollParent.scrollTo).toHaveBeenCalledWith(
            expect.objectContaining({ top: 300 - 0 - 200 })
        );
        expect(ref.current?.getCurrentHunkIndex()).toBe(2);
    });

    it('is a no-op for negative index', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(<UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />);
        const { scrollParent } = setupScrollParent(container, 'diff');
        ref.current?.scrollToHunk(-1);
        expect(scrollParent.scrollTo).not.toHaveBeenCalled();
        expect(ref.current?.getCurrentHunkIndex()).toBe(-1);
    });

    it('is a no-op for index beyond hunk count', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(<UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />);
        const { scrollParent } = setupScrollParent(container, 'diff');
        ref.current?.scrollToHunk(10);
        expect(scrollParent.scrollTo).not.toHaveBeenCalled();
        expect(ref.current?.getCurrentHunkIndex()).toBe(-1);
    });

    it('is a no-op for diff with no edits', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(<UnifiedDiffViewer ref={ref} diff={NO_HUNK_DIFF} data-testid="diff" />);
        const { scrollParent } = setupScrollParent(container, 'diff');
        ref.current?.scrollToHunk(0);
        expect(scrollParent.scrollTo).not.toHaveBeenCalled();
    });

    it('updates the cursor so subsequent next/prev uses the new position', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(<UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />);
        setupScrollParent(container, 'diff');
        ref.current?.scrollToHunk(1); // jump to index 1
        ref.current?.scrollToNextHunk(); // should go to index 2
        expect(ref.current?.getCurrentHunkIndex()).toBe(2);
    });
});

// ============================================================================
// getCurrentHunkIndex + scrollToHunk — SideBySideDiffViewer
// ============================================================================

describe('SideBySideDiffViewer — getCurrentHunkIndex and scrollToHunk', () => {
    afterEach(() => vi.restoreAllMocks());

    it('getCurrentHunkIndex returns -1 before navigation', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<SideBySideDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="sxs" />);
        expect(ref.current?.getCurrentHunkIndex()).toBe(-1);
    });

    it('getCurrentHunkIndex advances with scrollToNextHunk', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(<SideBySideDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="sxs" />);
        setupScrollParent(container, 'sxs');
        ref.current?.scrollToNextHunk();
        expect(ref.current?.getCurrentHunkIndex()).toBe(0);
    });

    it('scrollToHunk updates the cursor', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(<SideBySideDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="sxs" />);
        const { scrollParent } = setupScrollParent(container, 'sxs');
        ref.current?.scrollToHunk(2);
        expect(scrollParent.scrollTo).toHaveBeenCalled();
        expect(ref.current?.getCurrentHunkIndex()).toBe(2);
    });

    it('scrollToHunk is a no-op for invalid index', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(<SideBySideDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="sxs" />);
        const { scrollParent } = setupScrollParent(container, 'sxs');
        ref.current?.scrollToHunk(99);
        expect(scrollParent.scrollTo).not.toHaveBeenCalled();
        expect(ref.current?.getCurrentHunkIndex()).toBe(-1);
    });
});
