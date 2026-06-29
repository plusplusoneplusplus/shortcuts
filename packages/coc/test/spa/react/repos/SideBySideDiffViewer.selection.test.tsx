/**
 * Regression tests for SideBySideDiffViewer column-scoped text selection.
 *
 * Left and right cells are interleaved per row in the DOM, so a native drag down one
 * column would otherwise also sweep the interleaved cells of the other column. While a
 * drag is active the OTHER column must be `user-select: none`, scoped to the column the
 * drag started in, and released on mouse up.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { SideBySideDiffViewer } from '../../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer';

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

function columns(container: HTMLElement) {
    const all = Array.from(container.querySelectorAll<HTMLElement>('.w-1\\/2'));
    return {
        left: all.filter(c => !c.className.includes('border-l')),
        right: all.filter(c => c.className.includes('border-l')),
    };
}

const isLocked = (el: HTMLElement) => el.style.userSelect === 'none';

describe('SideBySideDiffViewer — column-scoped selection', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('locks the right column while a selection starts in the left column', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} enableComments />);
        const { left, right } = columns(container);
        expect(left.length).toBeGreaterThan(0);
        expect(right.length).toBeGreaterThan(0);

        // No lock before any interaction
        expect(left.some(isLocked)).toBe(false);
        expect(right.some(isLocked)).toBe(false);

        fireEvent.mouseDown(left[0], { button: 0 });

        const after = columns(container);
        expect(after.right.every(isLocked)).toBe(true);
        expect(after.left.some(isLocked)).toBe(false);
    });

    it('locks the left column while a selection starts in the right column', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} enableComments />);
        const { right } = columns(container);

        fireEvent.mouseDown(right[0], { button: 0 });

        const after = columns(container);
        expect(after.left.every(isLocked)).toBe(true);
        expect(after.right.some(isLocked)).toBe(false);
    });

    it('releases the lock on mouse up', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} enableComments />);
        const { left } = columns(container);

        fireEvent.mouseDown(left[0], { button: 0 });
        expect(columns(container).right.every(isLocked)).toBe(true);

        fireEvent.mouseUp(left[0], { button: 0 });

        const after = columns(container);
        expect(after.left.some(isLocked)).toBe(false);
        expect(after.right.some(isLocked)).toBe(false);
    });

    it('locks the column even when comments are disabled', () => {
        // The cross-column selection bug affects plain (non-comment) split views too,
        // so the mousedown lock must be wired regardless of enableComments.
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} />);
        const { left } = columns(container);

        fireEvent.mouseDown(left[0], { button: 0 });

        expect(columns(container).right.every(isLocked)).toBe(true);
    });

    it('does not lock either column for a right-button mousedown', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} enableComments />);
        const { left } = columns(container);

        fireEvent.mouseDown(left[0], { button: 2 });

        const after = columns(container);
        expect(after.left.some(isLocked)).toBe(false);
        expect(after.right.some(isLocked)).toBe(false);
    });

    it('collapses a cross-column selection on mouse up so the highlight does not bleed', () => {
        const { container } = render(<SideBySideDiffViewer diff={TWO_HUNK_DIFF} enableComments />);
        const { left, right } = columns(container);
        const removeAllRanges = vi.fn();

        // Native range that starts in the left column and ends in the right column.
        vi.spyOn(window, 'getSelection').mockReturnValue({
            isCollapsed: false,
            rangeCount: 1,
            removeAllRanges,
            getRangeAt: () => ({ startContainer: left[0], endContainer: right[0], startOffset: 0, endOffset: 0 }),
            toString: () => 'cross column',
        } as unknown as Selection);

        fireEvent.mouseUp(left[0], { button: 0 });

        expect(removeAllRanges).toHaveBeenCalled();
    });
});
