/**
 * Tests for SideBySideDiffViewer — rendering, color mapping, hunk navigation, line numbers.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React, { createRef } from 'react';
import { SideBySideDiffViewer } from '../../../../src/server/spa/client/react/repos/SideBySideDiffViewer';
import type { UnifiedDiffViewerHandle } from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';

// Minimal two-hunk diff with both added and removed lines
const TWO_HUNK_DIFF = `diff --git a/foo.ts b/foo.ts
index 0000000..1111111 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
-old line 1
+new line 1
 context line
@@ -10,2 +10,2 @@
-old line 10
+new line 10`;

// Single-hunk diff: pure add (no corresponding remove)
const PURE_ADD_DIFF = `diff --git a/bar.ts b/bar.ts
index 0000000..2222222 100644
--- a/bar.ts
+++ b/bar.ts
@@ -1,1 +1,2 @@
 context
+added only`;

// Single-hunk diff: pure remove (no corresponding add)
const PURE_REMOVE_DIFF = `diff --git a/baz.ts b/baz.ts
index 0000000..3333333 100644
--- a/baz.ts
+++ b/baz.ts
@@ -1,2 +1,1 @@
 context
-removed only`;

describe('SideBySideDiffViewer — basic rendering', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('renders outer container with data-testid', () => {
        render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} data-testid="sxs-diff" />);
        expect(screen.getByTestId('sxs-diff')).toBeTruthy();
    });

    it('content rows have two w-1/2 column divs', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} />);
        const colDivs = container.querySelectorAll<HTMLElement>('.w-1\\/2');
        // Each content row produces 2 columns; there should be an even number > 0
        expect(colDivs.length).toBeGreaterThan(0);
        expect(colDivs.length % 2).toBe(0);
    });

    it('edit-group start rows have data-edit-start attribute', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} />);
        const editStarts = container.querySelectorAll('[data-edit-start]');
        // TWO_HUNK_DIFF has two edit groups (one per hunk) — each marked on the content row
        expect(editStarts.length).toBe(2);
        // Content rows (not hunk-header rows) carry data-edit-start
        for (const el of Array.from(editStarts)) {
            expect((el as HTMLElement).querySelector('.w-1\\/2')).toBeTruthy();
        }
    });

    it('hunk-header rows have data-hunk-header attribute', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} />);
        const hunkHeaders = container.querySelectorAll('[data-hunk-header]');
        expect(hunkHeaders.length).toBe(2);
    });

    it('hunk-header rows span full width (no w-1/2 children)', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} />);
        const hunkHeaders = container.querySelectorAll<HTMLElement>('[data-hunk-header]');
        for (const hdr of Array.from(hunkHeaders)) {
            expect(hdr.querySelector('.w-1\\/2')).toBeNull();
        }
    });

    it('hunk-header rows carry the correct CSS classes', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} />);
        const hdr = container.querySelector<HTMLElement>('[data-hunk-header]')!;
        expect(hdr.className).toContain('bg-[#dbedff]');
        expect(hdr.className).toContain('text-[#0550ae]');
    });
});

describe('SideBySideDiffViewer — color mapping', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('removed line: left column has red background', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} />);
        const cols = container.querySelectorAll<HTMLElement>('.w-1\\/2');
        // Find a left column with red bg
        const redLeft = Array.from(cols).find(el => el.className.includes('bg-[#fecaca]'));
        expect(redLeft).toBeTruthy();
    });

    it('removed line: right column does not have red background', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} />);
        // Right columns have border-l; verify none of them carry red bg
        const rightCols = Array.from(container.querySelectorAll<HTMLElement>('.w-1\\/2.border-l'));
        const anyRed = rightCols.some(el => el.className.includes('bg-[#fecaca]'));
        expect(anyRed).toBe(false);
    });

    it('added line: right column has green background', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} />);
        const rightCols = Array.from(container.querySelectorAll<HTMLElement>('.w-1\\/2.border-l'));
        const greenRight = rightCols.find(el => el.className.includes('bg-[#d1f7c4]'));
        expect(greenRight).toBeTruthy();
    });

    it('added line: left column does not have green background', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} />);
        const cols = Array.from(container.querySelectorAll<HTMLElement>('.w-1\\/2'));
        // Left cols don't have border-l
        const leftCols = cols.filter(el => !el.className.includes('border-l'));
        const anyGreen = leftCols.some(el => el.className.includes('bg-[#d1f7c4]'));
        expect(anyGreen).toBe(false);
    });

    it('context row: neither column has add/remove background', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} />);
        const cols = Array.from(container.querySelectorAll<HTMLElement>('.w-1\\/2'));
        // Find a pair of columns with no red/green/gray bg (context row)
        const hasSomeContext = cols.some(el =>
            !el.className.includes('bg-[#fecaca]') &&
            !el.className.includes('bg-[#d1f7c4]') &&
            !el.className.includes('bg-[#f0f0f0]')
        );
        expect(hasSomeContext).toBe(true);
    });

    it('pure add: right column shows added line, left column is gray filler', () => {
        const { container } = render(<SideBySideDiffViewer diff={PURE_ADD_DIFF} />);
        const leftCols = Array.from(container.querySelectorAll<HTMLElement>('.w-1\\/2')).filter(
            el => !el.className.includes('border-l')
        );
        const grayLeft = leftCols.find(el => el.className.includes('bg-[#f0f0f0]'));
        expect(grayLeft).toBeTruthy();
    });

    it('pure remove: left column shows removed line, right column is gray filler', () => {
        const { container } = render(<SideBySideDiffViewer diff={PURE_REMOVE_DIFF} />);
        const rightCols = Array.from(container.querySelectorAll<HTMLElement>('.w-1\\/2.border-l'));
        const grayRight = rightCols.find(el => el.className.includes('bg-[#f0f0f0]'));
        expect(grayRight).toBeTruthy();
    });

    it('empty filler cell renders non-breaking space', () => {
        const { container } = render(<SideBySideDiffViewer diff={PURE_ADD_DIFF} />);
        const leftCols = Array.from(container.querySelectorAll<HTMLElement>('.w-1\\/2')).filter(
            el => !el.className.includes('border-l') && el.className.includes('bg-[#f0f0f0]')
        );
        expect(leftCols.length).toBeGreaterThan(0);
        // Content span should contain the NBSP character
        const contentSpan = leftCols[0].querySelector('span.flex-1');
        expect(contentSpan?.textContent).toBe('\u00a0');
    });
});

describe('SideBySideDiffViewer — line numbers', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('showLineNumbers=true renders gutter spans in both columns', () => {
        const { container } = render(
            <SideBySideDiffViewer diff={TWO_HUNK_DIFF} showLineNumbers />
        );
        const gutterSpans = container.querySelectorAll<HTMLElement>('span.select-none.w-8');
        expect(gutterSpans.length).toBeGreaterThan(0);
    });

    it('showLineNumbers=false renders no gutter spans', () => {
        const { container } = render(
            <SideBySideDiffViewer diff={TWO_HUNK_DIFF} showLineNumbers={false} />
        );
        const gutterSpans = container.querySelectorAll<HTMLElement>('span.select-none.w-8');
        expect(gutterSpans.length).toBe(0);
    });

    it('left gutter shows old line number on removed line', () => {
        const { container } = render(
            <SideBySideDiffViewer diff={TWO_HUNK_DIFF} showLineNumbers />
        );
        // Left cols contain old line numbers
        const leftCols = Array.from(container.querySelectorAll<HTMLElement>('.w-1\\/2')).filter(
            el => !el.className.includes('border-l') && el.className.includes('bg-[#fecaca]')
        );
        expect(leftCols.length).toBeGreaterThan(0);
        const gutter = leftCols[0].querySelector<HTMLElement>('span.select-none');
        expect(gutter?.textContent?.trim()).toBe('1');
    });

    it('right gutter shows new line number on added line', () => {
        const { container } = render(
            <SideBySideDiffViewer diff={TWO_HUNK_DIFF} showLineNumbers />
        );
        const rightCols = Array.from(container.querySelectorAll<HTMLElement>('.w-1\\/2.border-l')).filter(
            el => el.className.includes('bg-[#d1f7c4]')
        );
        expect(rightCols.length).toBeGreaterThan(0);
        const gutter = rightCols[0].querySelector<HTMLElement>('span.select-none');
        expect(gutter?.textContent?.trim()).toBe('1');
    });
});

describe('SideBySideDiffViewer — hunk navigation ref', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('getHunkCount matches number of edit groups', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} ref={ref} />);
        // TWO_HUNK_DIFF has 2 edit groups (one per @@ hunk)
        expect(ref.current?.getHunkCount()).toBe(2);
    });

    it('getHunkCount is 0 for empty diff', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<SideBySideDiffViewer diff="" ref={ref} />);
        expect(ref.current?.getHunkCount()).toBe(0);
    });

    it('getHunkCount counts edit groups (not @@ headers) for single hunk with two edit groups', () => {
        // One @@ hunk containing two separate edit groups separated by a context line.
        const MULTI_EDIT_SINGLE_HUNK_DIFF = `@@ -1,7 +1,7 @@
-removed1
+added1
 context
-removed2
+added2
 more context`;
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<SideBySideDiffViewer diff={MULTI_EDIT_SINGLE_HUNK_DIFF} ref={ref} />);
        expect(ref.current?.getHunkCount()).toBe(2);
    });

    it('scrollToNextHunk scrolls the parent to an edit-start element', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(
            <SideBySideDiffViewer ref={ref} diff={TWO_HUNK_DIFF} data-testid="sxs-diff" />
        );
        const viewer = container.querySelector('[data-testid="sxs-diff"]')!;
        const scrollParent = viewer.parentElement!;
        scrollParent.style.overflowY = 'auto';
        scrollParent.scrollTo = vi.fn();
        ref.current?.scrollToNextHunk();
        expect(scrollParent.scrollTo).toHaveBeenCalled();
    });

    it('scrollToPrevHunk wraps to last edit group when called first (index = -1)', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(
            <SideBySideDiffViewer ref={ref} diff={TWO_HUNK_DIFF} data-testid="sxs-diff" />
        );
        const viewer = container.querySelector('[data-testid="sxs-diff"]')!;
        const scrollParent = viewer.parentElement!;
        scrollParent.style.overflowY = 'auto';
        Object.defineProperty(scrollParent, 'clientHeight', { value: 600, configurable: true });
        Object.defineProperty(scrollParent, 'scrollTop', { value: 0, configurable: true });
        vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue({
            top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON() {},
        });
        const editStarts = container.querySelectorAll('[data-edit-start]');
        expect(editStarts.length).toBe(2); // TWO_HUNK_DIFF has 2 edit groups
        const lastEdit = editStarts[editStarts.length - 1] as HTMLElement;
        vi.spyOn(lastEdit, 'getBoundingClientRect').mockReturnValue({
            top: 500, bottom: 520, left: 0, right: 800, width: 800, height: 20, x: 0, y: 0, toJSON() {},
        });
        scrollParent.scrollTo = vi.fn();
        // First call with no prior forward nav must scroll to the LAST edit group
        ref.current?.scrollToPrevHunk();
        expect(scrollParent.scrollTo).toHaveBeenCalledWith(
            expect.objectContaining({ top: 500 - 0 - 200 })
        );
    });
});

describe('SideBySideDiffViewer — onLinesReady callback', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('calls onLinesReady with a DiffLine[] whose length equals raw line count', async () => {
        const onLinesReady = vi.fn();
        await act(async () => {
            render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} onLinesReady={onLinesReady} />);
        });
        expect(onLinesReady).toHaveBeenCalled();
        const [lines] = onLinesReady.mock.calls[0] as [unknown[]];
        expect(Array.isArray(lines)).toBe(true);
        expect(lines.length).toBe(TWO_HUNK_DIFF.split('\n').length);
    });
});

describe('SideBySideDiffViewer — comment props deferred', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('renders with enableComments=true without any comment badge', () => {
        const { container } = render(
            <SideBySideDiffViewer diff={TWO_HUNK_DIFF} enableComments />
        );
        expect(container.querySelectorAll('[data-testid="comment-badge"]').length).toBe(0);
    });

    it('renders cleanly with all comment props provided', () => {
        const onAddComment = vi.fn();
        const onCommentClick = vi.fn();
        expect(() =>
            render(
                <SideBySideDiffViewer
                    diff={TWO_HUNK_DIFF}
                    enableComments
                    comments={[]}
                    onAddComment={onAddComment}
                    onCommentClick={onCommentClick}
                />
            )
        ).not.toThrow();
    });
});
