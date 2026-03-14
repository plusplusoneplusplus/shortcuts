/**
 * Tests for hunk navigation: HunkNavButtons, data-edit-start attribute,
 * and UnifiedDiffViewerHandle (scrollToNextHunk/scrollToPrevHunk/getHunkCount).
 * Also covers SideBySideDiffViewer navigation and the onLinesReady stale-closure regression.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React, { createRef } from 'react';
import {
    UnifiedDiffViewer,
    HunkNavButtons,
    computeEditStarts,
    computeDiffLines,
} from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';
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

/** One hunk with two edit groups separated by a context line. */
const MULTI_EDIT_SINGLE_HUNK_DIFF = `@@ -1,7 +1,7 @@
-removed1
+added1
 context
-removed2
+added2
 more context`;

// ============================================================================
// HunkNavButtons
// ============================================================================

describe('HunkNavButtons', () => {
    it('renders prev and next buttons', () => {
        render(<HunkNavButtons onPrev={() => {}} onNext={() => {}} />);
        expect(screen.getByTestId('prev-hunk-btn')).toBeTruthy();
        expect(screen.getByTestId('next-hunk-btn')).toBeTruthy();
    });

    it('prev button displays ▲', () => {
        render(<HunkNavButtons onPrev={() => {}} onNext={() => {}} />);
        expect(screen.getByTestId('prev-hunk-btn').textContent).toBe('▲');
    });

    it('next button displays ▼', () => {
        render(<HunkNavButtons onPrev={() => {}} onNext={() => {}} />);
        expect(screen.getByTestId('next-hunk-btn').textContent).toBe('▼');
    });

    it('calls onPrev when prev button clicked', async () => {
        const onPrev = vi.fn();
        render(<HunkNavButtons onPrev={onPrev} onNext={() => {}} />);
        await act(async () => {
            fireEvent.click(screen.getByTestId('prev-hunk-btn'));
        });
        expect(onPrev).toHaveBeenCalledOnce();
    });

    it('calls onNext when next button clicked', async () => {
        const onNext = vi.fn();
        render(<HunkNavButtons onPrev={() => {}} onNext={onNext} />);
        await act(async () => {
            fireEvent.click(screen.getByTestId('next-hunk-btn'));
        });
        expect(onNext).toHaveBeenCalledOnce();
    });

    it('has correct titles for accessibility', () => {
        render(<HunkNavButtons onPrev={() => {}} onNext={() => {}} />);
        expect(screen.getByTestId('prev-hunk-btn').getAttribute('title')).toBe('Previous change');
        expect(screen.getByTestId('next-hunk-btn').getAttribute('title')).toBe('Next change');
    });
});

// ============================================================================
// computeEditStarts
// ============================================================================

describe('computeEditStarts', () => {
    it('identifies edit starts from multi-hunk diff', () => {
        const lines = MULTI_HUNK_DIFF.split('\n');
        const diffLines = computeDiffLines(lines);
        const starts = computeEditStarts(diffLines);
        expect(starts.size).toBe(3);
    });

    it('identifies two edit groups within a single hunk', () => {
        const lines = MULTI_EDIT_SINGLE_HUNK_DIFF.split('\n');
        const diffLines = computeDiffLines(lines);
        const starts = computeEditStarts(diffLines);
        expect(starts.size).toBe(2);
    });

    it('returns empty set for diff with no edits', () => {
        const lines = NO_HUNK_DIFF.split('\n');
        const diffLines = computeDiffLines(lines);
        const starts = computeEditStarts(diffLines);
        expect(starts.size).toBe(0);
    });

    it('identifies single edit group', () => {
        const lines = SINGLE_HUNK_DIFF.split('\n');
        const diffLines = computeDiffLines(lines);
        const starts = computeEditStarts(diffLines);
        expect(starts.size).toBe(1);
    });
});

// ============================================================================
// data-hunk-header attribute
// ============================================================================

describe('UnifiedDiffViewer — data-hunk-header attribute', () => {
    it('marks hunk-header lines with data-hunk-header attribute', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={MULTI_HUNK_DIFF} data-testid="diff" />
        );
        const hunkHeaders = container.querySelectorAll('[data-hunk-header]');
        expect(hunkHeaders.length).toBe(3);
    });

    it('data-hunk-header is present even without enableComments', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SINGLE_HUNK_DIFF} data-testid="diff" />
        );
        const hunkHeaders = container.querySelectorAll('[data-hunk-header]');
        expect(hunkHeaders.length).toBe(1);
    });

    it('no data-hunk-header on non-hunk lines', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={NO_HUNK_DIFF} data-testid="diff" />
        );
        const hunkHeaders = container.querySelectorAll('[data-hunk-header]');
        expect(hunkHeaders.length).toBe(0);
    });
});

// ============================================================================
// data-edit-start attribute
// ============================================================================

describe('UnifiedDiffViewer — data-edit-start attribute', () => {
    it('marks the first line of each edit group', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={MULTI_HUNK_DIFF} data-testid="diff" />
        );
        const editStarts = container.querySelectorAll('[data-edit-start]');
        expect(editStarts.length).toBe(3);
    });

    it('marks two edit groups within a single hunk', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={MULTI_EDIT_SINGLE_HUNK_DIFF} data-testid="diff" />
        );
        const editStarts = container.querySelectorAll('[data-edit-start]');
        expect(editStarts.length).toBe(2);
    });

    it('no data-edit-start on diff with no edits', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={NO_HUNK_DIFF} data-testid="diff" />
        );
        const editStarts = container.querySelectorAll('[data-edit-start]');
        expect(editStarts.length).toBe(0);
    });
});

// ============================================================================
// UnifiedDiffViewerHandle (via ref)
// ============================================================================

describe('UnifiedDiffViewerHandle', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('getHunkCount returns the number of edit groups', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />);
        expect(ref.current?.getHunkCount()).toBe(3);
    });

    it('getHunkCount returns 0 for no-edit diff', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<UnifiedDiffViewer ref={ref} diff={NO_HUNK_DIFF} data-testid="diff" />);
        expect(ref.current?.getHunkCount()).toBe(0);
    });

    it('getHunkCount counts edit groups, not hunk headers', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<UnifiedDiffViewer ref={ref} diff={MULTI_EDIT_SINGLE_HUNK_DIFF} data-testid="diff" />);
        expect(ref.current?.getHunkCount()).toBe(2);
    });

    it('scrollToNextHunk scrolls the parent to an edit-start element', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(
            <UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />
        );
        const viewer = container.querySelector('[data-testid="diff"]')!;
        const scrollParent = viewer.parentElement!;
        scrollParent.style.overflowY = 'auto';
        scrollParent.scrollTo = vi.fn();
        ref.current?.scrollToNextHunk();
        expect(scrollParent.scrollTo).toHaveBeenCalled();
    });

    it('scrollToPrevHunk scrolls the parent to an edit-start element', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(
            <UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />
        );
        const viewer = container.querySelector('[data-testid="diff"]')!;
        const scrollParent = viewer.parentElement!;
        scrollParent.style.overflowY = 'auto';
        scrollParent.scrollTo = vi.fn();
        ref.current?.scrollToPrevHunk();
        expect(scrollParent.scrollTo).toHaveBeenCalled();
    });

    it('scrollToNextHunk offsets scroll by one-third of viewport height to center change', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(
            <UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />
        );
        const viewer = container.querySelector('[data-testid="diff"]')!;
        const scrollParent = viewer.parentElement!;
        scrollParent.style.overflowY = 'auto';
        Object.defineProperty(scrollParent, 'clientHeight', { value: 600, configurable: true });
        Object.defineProperty(scrollParent, 'scrollTop', { value: 0, configurable: true });
        vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue({
            top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON() {},
        });
        const editStarts = container.querySelectorAll('[data-edit-start]');
        if (editStarts.length > 0) {
            vi.spyOn(editStarts[0], 'getBoundingClientRect').mockReturnValue({
                top: 100, bottom: 120, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
            });
        }
        scrollParent.scrollTo = vi.fn();
        ref.current?.scrollToNextHunk();
        expect(scrollParent.scrollTo).toHaveBeenCalledWith(
            expect.objectContaining({ top: 100 - 200 }) // editTop(100) - parentTop(0) - clientHeight/3(200)
        );
    });

    it('scrollToPrevHunk offsets scroll by one-third of viewport height to center change', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(
            <UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />
        );
        const viewer = container.querySelector('[data-testid="diff"]')!;
        const scrollParent = viewer.parentElement!;
        scrollParent.style.overflowY = 'auto';
        Object.defineProperty(scrollParent, 'clientHeight', { value: 600, configurable: true });
        Object.defineProperty(scrollParent, 'scrollTop', { value: 1000, configurable: true });
        vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue({
            top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON() {},
        });
        const editStarts = container.querySelectorAll('[data-edit-start]');
        const lastEdit = editStarts[editStarts.length - 1];
        if (lastEdit) {
            vi.spyOn(lastEdit, 'getBoundingClientRect').mockReturnValue({
                top: -50, bottom: -30, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
            });
        }
        scrollParent.scrollTo = vi.fn();
        ref.current?.scrollToPrevHunk();
        expect(scrollParent.scrollTo).toHaveBeenCalledWith(
            expect.objectContaining({ top: 1000 + (-50) - 0 - 200 }) // scrollTop(1000) + editTop(-50) - parentTop(0) - clientHeight/3(200)
        );
    });

    it('scrollToNextHunk is a no-op when diff has no edits', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<UnifiedDiffViewer ref={ref} diff={NO_HUNK_DIFF} data-testid="diff" />);
        expect(() => ref.current?.scrollToNextHunk()).not.toThrow();
    });

    it('scrollToPrevHunk is a no-op when diff has no edits', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<UnifiedDiffViewer ref={ref} diff={NO_HUNK_DIFF} data-testid="diff" />);
        expect(() => ref.current?.scrollToPrevHunk()).not.toThrow();
    });

    it('scrollToNextHunk advances to next hunk on second click', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(
            <UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />
        );
        const viewer = container.querySelector('[data-testid="diff"]')!;
        const scrollParent = viewer.parentElement!;
        scrollParent.style.overflowY = 'auto';
        Object.defineProperty(scrollParent, 'clientHeight', { value: 600, configurable: true });
        Object.defineProperty(scrollParent, 'scrollTop', { value: 0, configurable: true });
        vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue({
            top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON() {},
        });
        const editStarts = container.querySelectorAll('[data-edit-start]');
        vi.spyOn(editStarts[0], 'getBoundingClientRect').mockReturnValue({
            top: 100, bottom: 120, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
        });
        vi.spyOn(editStarts[1], 'getBoundingClientRect').mockReturnValue({
            top: 300, bottom: 320, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
        });
        scrollParent.scrollTo = vi.fn();
        ref.current?.scrollToNextHunk(); // → index 0
        ref.current?.scrollToNextHunk(); // → index 1
        const calls = (scrollParent.scrollTo as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls[1][0]).toEqual(expect.objectContaining({ top: 300 - 0 - 200 }));
    });

    it('scrollToNextHunk wraps to first hunk after last', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(
            <UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />
        );
        const viewer = container.querySelector('[data-testid="diff"]')!;
        const scrollParent = viewer.parentElement!;
        scrollParent.style.overflowY = 'auto';
        Object.defineProperty(scrollParent, 'clientHeight', { value: 600, configurable: true });
        Object.defineProperty(scrollParent, 'scrollTop', { value: 0, configurable: true });
        vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue({
            top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON() {},
        });
        const editStarts = container.querySelectorAll('[data-edit-start]');
        const topValues = [100, 300, 500];
        for (let i = 0; i < Math.min(editStarts.length, topValues.length); i++) {
            const top = topValues[i];
            vi.spyOn(editStarts[i], 'getBoundingClientRect').mockReturnValue({
                top, bottom: top + 20, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
            });
        }
        scrollParent.scrollTo = vi.fn();
        const total = editStarts.length;
        for (let i = 0; i < total; i++) ref.current?.scrollToNextHunk(); // exhaust all
        ref.current?.scrollToNextHunk(); // wraps back to index 0
        const calls = (scrollParent.scrollTo as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls[total][0]).toEqual(expect.objectContaining({ top: 100 - 0 - 200 }));
    });

    it('scrollToPrevHunk wraps to last hunk when called first', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(
            <UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />
        );
        const viewer = container.querySelector('[data-testid="diff"]')!;
        const scrollParent = viewer.parentElement!;
        scrollParent.style.overflowY = 'auto';
        Object.defineProperty(scrollParent, 'clientHeight', { value: 600, configurable: true });
        Object.defineProperty(scrollParent, 'scrollTop', { value: 0, configurable: true });
        vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue({
            top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON() {},
        });
        const editStarts = container.querySelectorAll('[data-edit-start]');
        const lastEdit = editStarts[editStarts.length - 1];
        vi.spyOn(lastEdit, 'getBoundingClientRect').mockReturnValue({
            top: 500, bottom: 520, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
        });
        scrollParent.scrollTo = vi.fn();
        ref.current?.scrollToPrevHunk(); // no prior forward nav → wraps to last
        expect(scrollParent.scrollTo).toHaveBeenCalledWith(
            expect.objectContaining({ top: 500 - 0 - 200 })
        );
    });

    it('index resets when diff prop changes', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container, rerender } = render(
            <UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />
        );
        const viewer = container.querySelector('[data-testid="diff"]')!;
        const scrollParent = viewer.parentElement!;
        scrollParent.style.overflowY = 'auto';
        Object.defineProperty(scrollParent, 'clientHeight', { value: 600, configurable: true });
        Object.defineProperty(scrollParent, 'scrollTop', { value: 0, configurable: true });
        vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue({
            top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON() {},
        });
        let editStarts = container.querySelectorAll('[data-edit-start]');
        vi.spyOn(editStarts[0], 'getBoundingClientRect').mockReturnValue({
            top: 100, bottom: 120, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
        });
        vi.spyOn(editStarts[1], 'getBoundingClientRect').mockReturnValue({
            top: 300, bottom: 320, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
        });
        scrollParent.scrollTo = vi.fn();
        ref.current?.scrollToNextHunk(); // index → 0
        ref.current?.scrollToNextHunk(); // index → 1

        // Re-render with a different diff to trigger index reset
        rerender(<UnifiedDiffViewer ref={ref} diff={SINGLE_HUNK_DIFF} data-testid="diff" />);

        editStarts = container.querySelectorAll('[data-edit-start]');
        if (editStarts.length > 0) {
            vi.spyOn(editStarts[0], 'getBoundingClientRect').mockReturnValue({
                top: 50, bottom: 70, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
            });
        }
        (scrollParent.scrollTo as ReturnType<typeof vi.fn>).mockClear();
        ref.current?.scrollToNextHunk(); // index was reset to -1, so should go to 0
        expect(scrollParent.scrollTo).toHaveBeenCalledWith(
            expect.objectContaining({ top: 50 - 0 - 200 })
        );
    });
});

// ============================================================================
// CommitFileContent — nav buttons presence
// ============================================================================

import { CommitFileContent } from '../../../../src/server/spa/client/react/repos/CommitFileContent';

const mockFetchApi = vi.fn();
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: unknown[]) => mockFetchApi(...args),
}));

describe('CommitFileContent — hunk navigation buttons', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders prev and next hunk buttons in the header', async () => {
        mockFetchApi.mockResolvedValue({
            diff: '@@ -1,2 +1,2 @@\n-old\n+new',
        });

        render(<CommitFileContent workspaceId="ws-1" hash="abc" filePath="src/app.ts" />);

        // Wait for diff to load
        await screen.findByTestId('commit-file-diff-content');

        expect(screen.getByTestId('prev-hunk-btn')).toBeTruthy();
        expect(screen.getByTestId('next-hunk-btn')).toBeTruthy();
    });
});

// ============================================================================
// SideBySideDiffViewer — navigation handle (regression for Bug 1 & 3)
// ============================================================================

describe('SideBySideDiffViewer — navigation handle', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('scrollToNextHunk scrolls to first edit group', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(
            <SideBySideDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="sxs" />
        );
        const viewer = container.querySelector('[data-testid="sxs"]')!;
        const scrollParent = viewer.parentElement!;
        scrollParent.style.overflowY = 'auto';
        scrollParent.scrollTo = vi.fn();
        ref.current?.scrollToNextHunk();
        expect(scrollParent.scrollTo).toHaveBeenCalled();
    });

    it('scrollToPrevHunk wraps to last edit group when called first (regression: off-by-one)', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(
            <SideBySideDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="sxs" />
        );
        const viewer = container.querySelector('[data-testid="sxs"]')!;
        const scrollParent = viewer.parentElement!;
        scrollParent.style.overflowY = 'auto';
        Object.defineProperty(scrollParent, 'clientHeight', { value: 600, configurable: true });
        Object.defineProperty(scrollParent, 'scrollTop', { value: 0, configurable: true });
        vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue({
            top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON() {},
        });
        const editStarts = container.querySelectorAll('[data-edit-start]');
        expect(editStarts.length).toBe(3); // MULTI_HUNK_DIFF has 3 edit groups
        const lastEdit = editStarts[editStarts.length - 1] as HTMLElement;
        vi.spyOn(lastEdit, 'getBoundingClientRect').mockReturnValue({
            top: 500, bottom: 520, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
        });
        scrollParent.scrollTo = vi.fn();
        // First call (index = -1) must land on the LAST edit group
        ref.current?.scrollToPrevHunk();
        expect(scrollParent.scrollTo).toHaveBeenCalledWith(
            expect.objectContaining({ top: 500 - 0 - 200 })
        );
    });

    it('getHunkCount returns edit-group count, not @@ header count', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        // MULTI_EDIT_SINGLE_HUNK_DIFF has 1 @@ header but 2 edit groups
        render(<SideBySideDiffViewer ref={ref} diff={MULTI_EDIT_SINGLE_HUNK_DIFF} />);
        expect(ref.current?.getHunkCount()).toBe(2);
    });
});

// ============================================================================
// onLinesReady stale-closure regression (Bug 2)
// ============================================================================

describe('UnifiedDiffViewer — onLinesReady stale-closure regression', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('navigation position is not reset when onLinesReady reference changes for the same diff', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const handler1 = vi.fn();
        const handler2 = vi.fn();

        const { container, rerender } = render(
            <UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} onLinesReady={handler1} data-testid="diff" />
        );
        const viewer = container.querySelector('[data-testid="diff"]')!;
        const scrollParent = viewer.parentElement!;
        scrollParent.style.overflowY = 'auto';
        Object.defineProperty(scrollParent, 'clientHeight', { value: 600, configurable: true });
        Object.defineProperty(scrollParent, 'scrollTop', { value: 0, configurable: true });
        vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue({
            top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON() {},
        });
        let editStarts = container.querySelectorAll('[data-edit-start]');
        const tops = [100, 300, 500];
        for (let i = 0; i < Math.min(editStarts.length, tops.length); i++) {
            const top = tops[i];
            vi.spyOn(editStarts[i] as HTMLElement, 'getBoundingClientRect').mockReturnValue({
                top, bottom: top + 20, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
            });
        }
        scrollParent.scrollTo = vi.fn();

        // Navigate to index 0
        ref.current?.scrollToNextHunk();
        const firstCall = (scrollParent.scrollTo as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(firstCall).toEqual(expect.objectContaining({ top: 100 - 0 - 200 }));

        // Re-render with a NEW onLinesReady reference but the SAME diff — must NOT reset index
        rerender(
            <UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} onLinesReady={handler2} data-testid="diff" />
        );

        editStarts = container.querySelectorAll('[data-edit-start]');
        for (let i = 0; i < Math.min(editStarts.length, tops.length); i++) {
            const top = tops[i];
            vi.spyOn(editStarts[i] as HTMLElement, 'getBoundingClientRect').mockReturnValue({
                top, bottom: top + 20, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
            });
        }
        (scrollParent.scrollTo as ReturnType<typeof vi.fn>).mockClear();

        // Should advance to index 1 (not wrap back to 0)
        ref.current?.scrollToNextHunk();
        const secondCall = (scrollParent.scrollTo as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(secondCall).toEqual(expect.objectContaining({ top: 300 - 0 - 200 }));
    });

    it('navigation position IS reset when the diff content changes', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container, rerender } = render(
            <UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />
        );
        const viewer = container.querySelector('[data-testid="diff"]')!;
        const scrollParent = viewer.parentElement!;
        scrollParent.style.overflowY = 'auto';
        Object.defineProperty(scrollParent, 'clientHeight', { value: 600, configurable: true });
        Object.defineProperty(scrollParent, 'scrollTop', { value: 0, configurable: true });
        vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue({
            top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON() {},
        });
        let editStarts = container.querySelectorAll('[data-edit-start]');
        for (let i = 0; i < editStarts.length; i++) {
            const top = (i + 1) * 100;
            vi.spyOn(editStarts[i] as HTMLElement, 'getBoundingClientRect').mockReturnValue({
                top, bottom: top + 20, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
            });
        }
        scrollParent.scrollTo = vi.fn();

        ref.current?.scrollToNextHunk(); // index → 0
        ref.current?.scrollToNextHunk(); // index → 1

        // Change diff — must reset index to -1
        rerender(<UnifiedDiffViewer ref={ref} diff={SINGLE_HUNK_DIFF} data-testid="diff" />);

        editStarts = container.querySelectorAll('[data-edit-start]');
        if (editStarts.length > 0) {
            vi.spyOn(editStarts[0] as HTMLElement, 'getBoundingClientRect').mockReturnValue({
                top: 50, bottom: 70, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
            });
        }
        (scrollParent.scrollTo as ReturnType<typeof vi.fn>).mockClear();

        // Index was reset to -1, so next must go to 0
        ref.current?.scrollToNextHunk();
        expect(scrollParent.scrollTo).toHaveBeenCalledWith(
            expect.objectContaining({ top: 50 - 0 - 200 })
        );
    });
});
