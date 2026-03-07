/**
 * Tests for hunk navigation: HunkNavButtons, data-edit-start attribute,
 * and UnifiedDiffViewerHandle (scrollToNextHunk/scrollToPrevHunk/getHunkCount).
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
        scrollParent.scrollTo = vi.fn();
        ref.current?.scrollToPrevHunk();
        expect(scrollParent.scrollTo).toHaveBeenCalled();
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
