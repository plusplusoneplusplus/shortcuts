/**
 * Tests for SideBySideDiffViewer — comment badges, highlights, selection toolbar.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { SideBySideDiffViewer } from '../../../../src/server/spa/client/react/repos/SideBySideDiffViewer';
import type { DiffComment, DiffCommentSelection } from '../../../../src/server/spa/client/diff-comment-types';

// Diff line index map for SIMPLE_DIFF:
//  0: diff --git ...  (meta)   → skipped in sxs
//  1: index ...       (meta)   → skipped
//  2: --- a/foo.ts   (meta)   → skipped
//  3: +++ b/foo.ts   (meta)   → skipped
//  4: @@ -1,2 +1,2 @@ (hunk-header)
//  5: -old line      (removed) → sxs left col, originalIndex=5
//  6: +new line      (added)   → sxs right col, originalIndex=6
//  7:  context line  (context) → sxs left+right, originalIndex=7
const SIMPLE_DIFF = `diff --git a/foo.ts b/foo.ts
index 0000000..1111111 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,2 +1,2 @@
-old line
+new line
 context line`;

function makeComment(overrides: {
    id?: string;
    diffLineStart: number;
    diffLineEnd: number;
    side?: DiffCommentSelection['side'];
    status?: DiffComment['status'];
}): DiffComment {
    return {
        id: overrides.id ?? 'c1',
        context: { repositoryId: 'repo', filePath: 'foo.ts', oldRef: 'HEAD~1', newRef: 'HEAD' },
        selection: {
            diffLineStart: overrides.diffLineStart,
            diffLineEnd: overrides.diffLineEnd,
            side: overrides.side ?? 'context',
            startColumn: 0,
            endColumn: 5,
        },
        selectedText: 'selected',
        comment: 'A comment body',
        status: overrides.status ?? 'open',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    };
}

/** Mock a window.getSelection() for two elements. */
function mockSelection(opts: {
    startEl: HTMLElement;
    endEl: HTMLElement;
    startOffset?: number;
    endOffset?: number;
    text?: string;
    collapsed?: boolean;
}) {
    const mockRange = {
        startContainer: opts.startEl,
        endContainer: opts.endEl,
        startOffset: opts.startOffset ?? 0,
        endOffset: opts.endOffset ?? 5,
        getBoundingClientRect: () => ({ top: 100, left: 200, width: 50, height: 16, bottom: 116, right: 250 }),
    };
    const mockSel = {
        isCollapsed: opts.collapsed ?? false,
        rangeCount: opts.collapsed ? 0 : 1,
        getRangeAt: (_: number) => mockRange,
        toString: () => opts.text ?? 'selected text',
    };
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSel as unknown as Selection);
    return { mockSel, mockRange };
}

afterEach(() => { vi.restoreAllMocks(); });

// ============================================================================
// Badge rendering
// ============================================================================

describe('SideBySideDiffViewer — comment badges', () => {
    it('no badges when enableComments=false even with comments', () => {
        const comments = [makeComment({ diffLineStart: 5, diffLineEnd: 5, side: 'removed' })];
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} comments={comments} />
        );
        expect(container.querySelectorAll('[data-testid="comment-badge"]').length).toBe(0);
    });

    it('no badges when enableComments=true but no comments prop', () => {
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments />
        );
        expect(container.querySelectorAll('[data-testid="comment-badge"]').length).toBe(0);
    });

    it('badge renders in left gutter for side=removed comment', () => {
        const c = makeComment({ diffLineStart: 5, diffLineEnd: 5, side: 'removed' });
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c]} />
        );
        // left col has data-split-side="left" and data-diff-line-index="5"
        const leftCol = container.querySelector<HTMLElement>('[data-split-side="left"][data-diff-line-index="5"]')!;
        expect(leftCol).not.toBeNull();
        const badge = leftCol.querySelector('[data-testid="comment-badge"]');
        expect(badge).not.toBeNull();
    });

    it('badge renders in right gutter for side=added comment', () => {
        const c = makeComment({ diffLineStart: 6, diffLineEnd: 6, side: 'added' });
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c]} />
        );
        const rightCol = container.querySelector<HTMLElement>('[data-split-side="right"][data-diff-line-index="6"]')!;
        expect(rightCol).not.toBeNull();
        const badge = rightCol.querySelector('[data-testid="comment-badge"]');
        expect(badge).not.toBeNull();
    });

    it('side=removed comment does NOT show badge in right gutter', () => {
        const c = makeComment({ diffLineStart: 5, diffLineEnd: 5, side: 'removed' });
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c]} />
        );
        // right col for originalIndex=6 (the added line) — no badge there
        const rightCol = container.querySelector<HTMLElement>('[data-split-side="right"][data-diff-line-index="6"]');
        if (rightCol) {
            expect(rightCol.querySelector('[data-testid="comment-badge"]')).toBeNull();
        }
    });

    it('side=added comment does NOT show badge in left gutter', () => {
        const c = makeComment({ diffLineStart: 6, diffLineEnd: 6, side: 'added' });
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c]} />
        );
        const leftCol = container.querySelector<HTMLElement>('[data-split-side="left"][data-diff-line-index="5"]');
        if (leftCol) {
            expect(leftCol.querySelector('[data-testid="comment-badge"]')).toBeNull();
        }
    });

    it('side=context comment shows badge in both left and right gutters', () => {
        const c = makeComment({ diffLineStart: 7, diffLineEnd: 7, side: 'context' });
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c]} />
        );
        // context line appears in both columns at originalIndex=7
        const leftCol = container.querySelector<HTMLElement>('[data-split-side="left"][data-diff-line-index="7"]')!;
        const rightCol = container.querySelector<HTMLElement>('[data-split-side="right"][data-diff-line-index="7"]')!;
        expect(leftCol?.querySelector('[data-testid="comment-badge"]')).not.toBeNull();
        expect(rightCol?.querySelector('[data-testid="comment-badge"]')).not.toBeNull();
    });

    it('open comment badge has bg-yellow-400 class', () => {
        const c = makeComment({ diffLineStart: 5, diffLineEnd: 5, side: 'removed', status: 'open' });
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c]} />
        );
        const badge = container.querySelector<HTMLElement>('[data-testid="comment-badge"]')!;
        expect(badge.className).toContain('bg-yellow-400');
    });

    it('resolved comment badge has bg-green-500 class', () => {
        const c = makeComment({ diffLineStart: 5, diffLineEnd: 5, side: 'removed', status: 'resolved' });
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c]} />
        );
        const badge = container.querySelector<HTMLElement>('[data-testid="comment-badge"]')!;
        expect(badge.className).toContain('bg-green-500');
    });

    it('orphaned comment does NOT render a badge', () => {
        const c = { ...makeComment({ diffLineStart: 5, diffLineEnd: 5, side: 'removed' }), status: 'orphaned' as any };
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c]} />
        );
        expect(container.querySelectorAll('[data-testid="comment-badge"]').length).toBe(0);
    });

    it('badge click calls onCommentClick with first comment', async () => {
        const onCommentClick = vi.fn();
        const c = makeComment({ diffLineStart: 5, diffLineEnd: 5, side: 'removed' });
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c]} onCommentClick={onCommentClick} />
        );
        const badge = container.querySelector<HTMLElement>('[data-testid="comment-badge"]')!;
        await act(async () => { fireEvent.click(badge); });
        expect(onCommentClick).toHaveBeenCalledOnce();
        expect(onCommentClick).toHaveBeenCalledWith(c, expect.objectContaining({ type: 'click' }));
    });

    it('two comments at distinct lines produce two badges', () => {
        const c1 = makeComment({ id: 'c1', diffLineStart: 5, diffLineEnd: 5, side: 'removed', status: 'open' });
        const c2 = makeComment({ id: 'c2', diffLineStart: 6, diffLineEnd: 6, side: 'added', status: 'resolved' });
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c1, c2]} />
        );
        expect(container.querySelectorAll('[data-testid="comment-badge"]').length).toBe(2);
    });
});

// ============================================================================
// Row highlight
// ============================================================================

describe('SideBySideDiffViewer — row highlight', () => {
    it('left cell gets yellow highlight for open comment at its originalIndex', () => {
        const c = makeComment({ diffLineStart: 5, diffLineEnd: 5, side: 'removed', status: 'open' });
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c]} />
        );
        const leftCol = container.querySelector<HTMLElement>('[data-split-side="left"][data-diff-line-index="5"]')!;
        expect(leftCol.className).toContain('bg-[#fff9c4]');
    });

    it('right cell gets yellow highlight for open comment at its originalIndex', () => {
        const c = makeComment({ diffLineStart: 6, diffLineEnd: 6, side: 'added', status: 'open' });
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c]} />
        );
        const rightCol = container.querySelector<HTMLElement>('[data-split-side="right"][data-diff-line-index="6"]')!;
        expect(rightCol.className).toContain('bg-[#fff9c4]');
    });

    it('left cell gets green+opacity highlight for resolved comment', () => {
        const c = makeComment({ diffLineStart: 5, diffLineEnd: 5, side: 'removed', status: 'resolved' });
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c]} />
        );
        const leftCol = container.querySelector<HTMLElement>('[data-split-side="left"][data-diff-line-index="5"]')!;
        expect(leftCol.className).toContain('bg-[#e6ffed]');
        expect(leftCol.className).toContain('opacity-80');
    });

    it('left and right cells are highlighted independently', () => {
        // Open comment on left (removed), resolved on right (added)
        const c1 = makeComment({ id: 'left', diffLineStart: 5, diffLineEnd: 5, side: 'removed', status: 'open' });
        const c2 = makeComment({ id: 'right', diffLineStart: 6, diffLineEnd: 6, side: 'added', status: 'resolved' });
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c1, c2]} />
        );
        const leftCol = container.querySelector<HTMLElement>('[data-split-side="left"][data-diff-line-index="5"]')!;
        const rightCol = container.querySelector<HTMLElement>('[data-split-side="right"][data-diff-line-index="6"]')!;
        expect(leftCol.className).toContain('bg-[#fff9c4]');
        expect(rightCol.className).toContain('bg-[#e6ffed]');
        expect(rightCol.className).toContain('opacity-80');
    });
});

// ============================================================================
// SelectionToolbar — visibility
// ============================================================================

describe('SideBySideDiffViewer — SelectionToolbar', () => {
    it('toolbar does not render when enableComments=false', () => {
        render(<SideBySideDiffViewer diff={SIMPLE_DIFF} />);
        expect(screen.queryByTestId('selection-toolbar')).toBeNull();
    });

    it('toolbar appears when selecting text within the left column', async () => {
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments />
        );
        const leftCol = container.querySelector<HTMLElement>('[data-split-side="left"][data-diff-line-index="5"]')!;
        expect(leftCol).not.toBeNull();
        mockSelection({ startEl: leftCol, endEl: leftCol });

        await act(async () => { fireEvent.mouseUp(container.firstElementChild!); });

        expect(screen.getByTestId('selection-toolbar')).toBeTruthy();
    });

    it('toolbar appears when selecting text within the right column', async () => {
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments />
        );
        const rightCol = container.querySelector<HTMLElement>('[data-split-side="right"][data-diff-line-index="6"]')!;
        expect(rightCol).not.toBeNull();
        mockSelection({ startEl: rightCol, endEl: rightCol });

        await act(async () => { fireEvent.mouseUp(container.firstElementChild!); });

        expect(screen.getByTestId('selection-toolbar')).toBeTruthy();
    });

    it('toolbar does NOT appear when selection spans left and right columns', async () => {
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments />
        );
        const leftCol  = container.querySelector<HTMLElement>('[data-split-side="left"][data-diff-line-index="5"]')!;
        const rightCol = container.querySelector<HTMLElement>('[data-split-side="right"][data-diff-line-index="6"]')!;
        mockSelection({ startEl: leftCol, endEl: rightCol });

        await act(async () => { fireEvent.mouseUp(container.firstElementChild!); });

        expect(screen.queryByTestId('selection-toolbar')).toBeNull();
    });

    it('toolbar hides on mousedown outside toolbar', async () => {
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments />
        );
        const leftCol = container.querySelector<HTMLElement>('[data-split-side="left"][data-diff-line-index="5"]')!;
        mockSelection({ startEl: leftCol, endEl: leftCol });

        await act(async () => { fireEvent.mouseUp(container.firstElementChild!); });
        expect(screen.getByTestId('selection-toolbar')).toBeTruthy();

        await act(async () => { fireEvent.mouseDown(container.firstElementChild!); });
        expect(screen.queryByTestId('selection-toolbar')).toBeNull();
    });

    it('collapsed selection does not show toolbar', async () => {
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments />
        );
        const leftCol = container.querySelector<HTMLElement>('[data-split-side="left"][data-diff-line-index="5"]')!;
        mockSelection({ startEl: leftCol, endEl: leftCol, collapsed: true });

        await act(async () => { fireEvent.mouseUp(container.firstElementChild!); });

        expect(screen.queryByTestId('selection-toolbar')).toBeNull();
    });
});

// ============================================================================
// SelectionToolbar — side derivation
// ============================================================================

describe('SideBySideDiffViewer — onAddComment side derivation', () => {
    it('calls onAddComment with side=removed when selecting a removed line in the left column', async () => {
        const onAddComment = vi.fn();
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments onAddComment={onAddComment} />
        );
        // Left col at index 5 is 'removed'
        const leftCol = container.querySelector<HTMLElement>('[data-split-side="left"][data-line-type="removed"]')!;
        expect(leftCol).not.toBeNull();
        mockSelection({ startEl: leftCol, endEl: leftCol, text: 'old line' });

        await act(async () => { fireEvent.mouseUp(container.firstElementChild!); });
        const toolbar = screen.getByTestId('selection-toolbar');
        await act(async () => { fireEvent.click(toolbar); });

        expect(onAddComment).toHaveBeenCalledOnce();
        const [sel] = onAddComment.mock.calls[0] as [DiffCommentSelection];
        expect(sel.side).toBe('removed');
    });

    it('calls onAddComment with side=added when selecting an added line in the right column', async () => {
        const onAddComment = vi.fn();
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments onAddComment={onAddComment} />
        );
        // Right col at index 6 is 'added'
        const rightCol = container.querySelector<HTMLElement>('[data-split-side="right"][data-line-type="added"]')!;
        expect(rightCol).not.toBeNull();
        mockSelection({ startEl: rightCol, endEl: rightCol, text: 'new line' });

        await act(async () => { fireEvent.mouseUp(container.firstElementChild!); });
        const toolbar = screen.getByTestId('selection-toolbar');
        await act(async () => { fireEvent.click(toolbar); });

        expect(onAddComment).toHaveBeenCalledOnce();
        const [sel] = onAddComment.mock.calls[0] as [DiffCommentSelection];
        expect(sel.side).toBe('added');
    });

    it('calls onAddComment with side=context when selecting a context line in the left column', async () => {
        const onAddComment = vi.fn();
        const { container } = render(
            <SideBySideDiffViewer diff={SIMPLE_DIFF} enableComments onAddComment={onAddComment} />
        );
        const leftCtx = container.querySelector<HTMLElement>('[data-split-side="left"][data-line-type="context"]')!;
        expect(leftCtx).not.toBeNull();
        mockSelection({ startEl: leftCtx, endEl: leftCtx });

        await act(async () => { fireEvent.mouseUp(container.firstElementChild!); });
        const toolbar = screen.getByTestId('selection-toolbar');
        await act(async () => { fireEvent.click(toolbar); });

        expect(onAddComment).toHaveBeenCalledOnce();
        const [sel] = onAddComment.mock.calls[0] as [DiffCommentSelection];
        expect(sel.side).toBe('context');
    });
});
