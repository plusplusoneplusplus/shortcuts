/**
 * Tests for UnifiedDiffViewer — selection detection and toolbar integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
    UnifiedDiffViewer,
    buildLineCommentMap,
    getLineHighlightClass,
} from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';
import type { DiffComment, DiffCommentSelection } from '../../../../src/server/spa/client/diff-comment-types';

// Minimal two-line single-file diff
const SIMPLE_DIFF = `diff --git a/foo.ts b/foo.ts
index 0000000..1111111 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,2 +1,2 @@
-old line
+new line
 context line`;

// Multi-file diff (two sections)
const MULTI_FILE_DIFF = `diff --git a/a.ts b/a.ts
index 0000000..1111111 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
+added in a
diff --git a/b.ts b/b.ts
index 0000000..2222222 100644
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
+added in b`;

/** Helper: find a line element by its data-diff-line-index value */
function lineEl(container: HTMLElement, idx: number): HTMLElement | null {
    return container.querySelector<HTMLElement>(`[data-diff-line-index="${idx}"]`);
}

/** Mock a window.getSelection() that returns a range anchored on two elements. */
function mockSelection(opts: {
    startEl: HTMLElement;
    endEl: HTMLElement;
    startOffset?: number;
    endOffset?: number;
    text?: string;
    collapsed?: boolean;
    rectOverride?: { top: number; left: number; width: number; height: number };
}) {
    const rect = opts.rectOverride ?? { top: 100, left: 200, width: 50, height: 16 };
    const mockRange = {
        startContainer: opts.startEl,
        endContainer: opts.endEl,
        startOffset: opts.startOffset ?? 0,
        endOffset: opts.endOffset ?? 5,
        getBoundingClientRect: () => ({
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            bottom: rect.top + rect.height,
            right: rect.left + rect.width,
        }),
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

describe('UnifiedDiffViewer — selection detection', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    // 1. No toolbar when enableComments is false
    it('does not show context menu when enableComments is false', () => {
        render(<UnifiedDiffViewer diff={SIMPLE_DIFF} />);
        expect(screen.queryByTestId('context-menu')).toBeNull();
        // fire contextmenu on body — no handlers should attach
        fireEvent.contextMenu(document.body);
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    // 2. No toolbar when selection is collapsed
    it('does not show context menu when selection is collapsed', () => {
        const { container } = render(<UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments />);
        vi.spyOn(window, 'getSelection').mockReturnValue({
            isCollapsed: true,
            rangeCount: 0,
            getRangeAt: () => { throw new Error('no range'); },
            toString: () => '',
        } as unknown as Selection);
        const wrapper = container.querySelector('[data-testid]') ?? container.firstElementChild!;
        fireEvent.mouseUp(wrapper);
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    // 3. No context menu when selection anchors outside data-diff-line-index elements
    it('does not show context menu when anchor has no data-diff-line-index ancestor', () => {
        const { container } = render(<UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments />);
        const outsideEl = document.createElement('div');
        document.body.appendChild(outsideEl);

        mockSelection({ startEl: outsideEl, endEl: outsideEl });

        const wrapper = container.firstElementChild!;
        fireEvent.mouseUp(wrapper);
        expect(screen.queryByTestId('context-menu')).toBeNull();

        document.body.removeChild(outsideEl);
    });

    // 4. No context menu when either endpoint is a hunk-header line
    it('does not show context menu when endpoint is a hunk-header line', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments data-testid="diff" />
        );
        // line 4 is the @@ hunk-header (0-based in the split)
        const hunkEl = container.querySelector<HTMLElement>('[data-line-type="hunk-header"]');
        if (!hunkEl) return; // skip if not present
        const addedEl = container.querySelector<HTMLElement>('[data-line-type="added"]')!;
        mockSelection({ startEl: hunkEl, endEl: addedEl });
        fireEvent.mouseUp(container.firstElementChild!);
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    // 5. No context menu when selection crosses a diff --git meta line
    it('does not show context menu when selection crosses a diff --git meta boundary', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={MULTI_FILE_DIFF} enableComments data-testid="diff" />
        );
        const allMetaEls = container.querySelectorAll<HTMLElement>('[data-line-type="meta"]');
        if (allMetaEls.length < 2) return;
        const firstAdded = lineEl(container as HTMLElement, 6);
        const secondAdded = container.querySelector<HTMLElement>(
            '[data-diff-line-index="11"]'
        );
        if (!firstAdded || !secondAdded) return;
        mockSelection({ startEl: firstAdded, endEl: secondAdded });
        fireEvent.mouseUp(container.firstElementChild!);
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    // 6. Context menu appears on right-click after valid selection
    it('shows context menu on right-click after valid selection', async () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments data-testid="diff" />
        );
        const addedEl = container.querySelector<HTMLElement>('[data-line-type="added"]')!;
        const contextEl = container.querySelector<HTMLElement>('[data-line-type="context"]')!;
        mockSelection({ startEl: addedEl, endEl: contextEl });

        await act(async () => {
            fireEvent.mouseUp(container.firstElementChild!);
        });
        // mouseUp alone does NOT show the menu
        expect(screen.queryByTestId('context-menu')).toBeNull();

        await act(async () => {
            fireEvent.contextMenu(container.firstElementChild!, { clientX: 150, clientY: 200 });
        });

        expect(screen.getByTestId('context-menu')).toBeTruthy();
    });

    // 6b. mouseUp with valid selection does NOT show context menu
    it('does NOT show context menu after mouseUp with valid selection', async () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments data-testid="diff" />
        );
        const addedEl = container.querySelector<HTMLElement>('[data-line-type="added"]')!;
        const contextEl = container.querySelector<HTMLElement>('[data-line-type="context"]')!;
        mockSelection({ startEl: addedEl, endEl: contextEl });

        await act(async () => {
            fireEvent.mouseUp(container.firstElementChild!);
        });

        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    // 6c. Right-click with no prior selection does NOT show context menu
    it('does NOT show context menu on right-click without a selection', async () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments data-testid="diff" />
        );
        // No mouseUp / no selection captured
        vi.spyOn(window, 'getSelection').mockReturnValue({
            isCollapsed: true,
            rangeCount: 0,
            getRangeAt: () => { throw new Error('no range'); },
            toString: () => '',
        } as unknown as Selection);

        await act(async () => {
            fireEvent.contextMenu(container.firstElementChild!, { clientX: 100, clientY: 100 });
        });

        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    // 7. onAddComment fires with correct DiffCommentSelection when context menu item clicked
    it('calls onAddComment with correct selection and text when context menu item clicked', async () => {
        const onAddComment = vi.fn();
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments onAddComment={onAddComment} data-testid="diff" />
        );
        const addedEl = container.querySelector<HTMLElement>('[data-line-type="added"]')!;
        const contextEl = container.querySelector<HTMLElement>('[data-line-type="context"]')!;
        mockSelection({
            startEl: addedEl,
            endEl: contextEl,
            startOffset: 1,
            endOffset: 3,
            text: 'hello',
        });

        await act(async () => {
            fireEvent.mouseUp(container.firstElementChild!);
        });
        await act(async () => {
            fireEvent.contextMenu(container.firstElementChild!, { clientX: 150, clientY: 200 });
        });

        const menuItem = screen.getByTestId('context-menu-item-0');
        await act(async () => {
            fireEvent.click(menuItem);
        });

        expect(onAddComment).toHaveBeenCalledOnce();
        const [sel, text, pos] = onAddComment.mock.calls[0] as [DiffCommentSelection, string, { top: number; left: number }];
        expect(typeof sel.diffLineStart).toBe('number');
        expect(typeof sel.diffLineEnd).toBe('number');
        expect(text).toBe('hello');
        expect(typeof pos.top).toBe('number');
        expect(typeof pos.left).toBe('number');
    });

    // 8. Context menu dismisses on mousedown
    it('hides context menu on mousedown', async () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments data-testid="diff" />
        );
        const addedEl = container.querySelector<HTMLElement>('[data-line-type="added"]')!;
        const contextEl = container.querySelector<HTMLElement>('[data-line-type="context"]')!;
        mockSelection({ startEl: addedEl, endEl: contextEl });

        await act(async () => {
            fireEvent.mouseUp(container.firstElementChild!);
        });
        await act(async () => {
            fireEvent.contextMenu(container.firstElementChild!, { clientX: 150, clientY: 200 });
        });
        expect(screen.getByTestId('context-menu')).toBeTruthy();

        await act(async () => {
            fireEvent.mouseDown(container.firstElementChild!);
        });
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    // 9. Context menu click on item dismisses menu
    it('context menu item click dismisses the menu', async () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments data-testid="diff" />
        );
        const addedEl = container.querySelector<HTMLElement>('[data-line-type="added"]')!;
        const contextEl = container.querySelector<HTMLElement>('[data-line-type="context"]')!;
        mockSelection({ startEl: addedEl, endEl: contextEl });

        await act(async () => {
            fireEvent.mouseUp(container.firstElementChild!);
        });
        await act(async () => {
            fireEvent.contextMenu(container.firstElementChild!, { clientX: 150, clientY: 200 });
        });
        expect(screen.getByTestId('context-menu')).toBeTruthy();

        const menuItem = screen.getByTestId('context-menu-item-0');
        await act(async () => {
            fireEvent.click(menuItem);
        });
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });
});

// ============================================================================
// Helper fixture factory
// ============================================================================

function makeComment(overrides: {
    id?: string;
    diffLineStart: number;
    diffLineEnd: number;
    status?: 'open' | 'resolved';
}): DiffComment {
    return {
        id: overrides.id ?? 'c1',
        context: { repositoryId: 'repo', filePath: 'foo.ts', oldRef: 'HEAD~1', newRef: 'HEAD' },
        selection: {
            diffLineStart: overrides.diffLineStart,
            diffLineEnd: overrides.diffLineEnd,
            side: 'added',
            startColumn: 0,
            endColumn: 5,
        },
        selectedText: 'text',
        comment: 'A comment',
        status: overrides.status ?? 'open',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    };
}

// ============================================================================
// buildLineCommentMap tests
// ============================================================================

describe('buildLineCommentMap', () => {
    it('single-line comment maps to the correct line', () => {
        const c = makeComment({ diffLineStart: 2, diffLineEnd: 2 });
        const map = buildLineCommentMap([c]);
        expect(map.get(2)).toEqual([c]);
        expect(map.has(1)).toBe(false);
        expect(map.has(3)).toBe(false);
    });

    it('multi-line comment populates all covered keys', () => {
        const c = makeComment({ diffLineStart: 1, diffLineEnd: 3 });
        const map = buildLineCommentMap([c]);
        expect(map.get(1)).toEqual([c]);
        expect(map.get(2)).toEqual([c]);
        expect(map.get(3)).toEqual([c]);
        expect(map.has(0)).toBe(false);
        expect(map.has(4)).toBe(false);
    });

    it('multiple comments overlapping on the same line both appear', () => {
        const c1 = makeComment({ id: 'c1', diffLineStart: 4, diffLineEnd: 6 });
        const c2 = makeComment({ id: 'c2', diffLineStart: 5, diffLineEnd: 5 });
        const map = buildLineCommentMap([c1, c2]);
        expect(map.get(5)).toEqual([c1, c2]);
        expect(map.get(4)).toEqual([c1]);
        expect(map.get(6)).toEqual([c1]);
    });
});

// ============================================================================
// getLineHighlightClass tests
// ============================================================================

describe('getLineHighlightClass', () => {
    it('returns empty string for undefined', () => {
        expect(getLineHighlightClass(undefined)).toBe('');
    });

    it('returns empty string for empty array', () => {
        expect(getLineHighlightClass([])).toBe('');
    });

    it('returns yellow highlight for open comment', () => {
        const c = makeComment({ diffLineStart: 1, diffLineEnd: 1, status: 'open' });
        expect(getLineHighlightClass([c])).toBe('bg-[#fff9c4] dark:bg-[#3d3a00]');
    });

    it('returns green highlight for resolved-only comments', () => {
        const c = makeComment({ diffLineStart: 1, diffLineEnd: 1, status: 'resolved' });
        expect(getLineHighlightClass([c])).toBe('bg-[#e6ffed] dark:bg-[#1a3d2b] opacity-80');
    });

    it('open takes priority over resolved in mixed array', () => {
        const open = makeComment({ id: 'o', diffLineStart: 1, diffLineEnd: 1, status: 'open' });
        const resolved = makeComment({ id: 'r', diffLineStart: 1, diffLineEnd: 1, status: 'resolved' });
        expect(getLineHighlightClass([resolved, open])).toBe('bg-[#fff9c4] dark:bg-[#3d3a00]');
    });
});

// ============================================================================
// UnifiedDiffViewer — comment badges and highlights
// ============================================================================

// Line indices for SIMPLE_DIFF:
//  0: diff --git ...  (meta)
//  1: index ...       (meta)
//  2: --- a/foo.ts   (meta)
//  3: +++ b/foo.ts   (meta)
//  4: @@ -1,2 ...    (hunk-header)
//  5: -old line      (removed)
//  6: +new line      (added)
//  7:  context line  (context)

describe('UnifiedDiffViewer — comment badges and highlights', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('no badge elements when comments prop is absent', () => {
        const { container } = render(<UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments />);
        expect(container.querySelectorAll('[data-testid="comment-badge"]').length).toBe(0);
    });

    it('no badge elements when enableComments is false even with comments', () => {
        const comments = [makeComment({ diffLineStart: 6, diffLineEnd: 6 })];
        const { container } = render(<UnifiedDiffViewer diff={SIMPLE_DIFF} comments={comments} />);
        expect(container.querySelectorAll('[data-testid="comment-badge"]').length).toBe(0);
    });

    it('badge rendered on commented line', () => {
        const comments = [makeComment({ diffLineStart: 6, diffLineEnd: 6 })];
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments comments={comments} />
        );
        const badges = container.querySelectorAll('[data-testid="comment-badge"]');
        expect(badges.length).toBe(1);
        expect(badges[0].textContent).toBe('1');
    });

    it('no badge on line outside comment range', () => {
        // comment only on line 6; line 5 should have no badge
        const comments = [makeComment({ diffLineStart: 6, diffLineEnd: 6 })];
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments comments={comments} />
        );
        const lineDiv = container.querySelector<HTMLElement>('[data-diff-line-index="5"]')!;
        expect(lineDiv.querySelector('[data-testid="comment-badge"]')).toBeNull();
    });

    it('badge click fires onCommentClick with first comment and event', async () => {
        const onCommentClick = vi.fn();
        const c = makeComment({ diffLineStart: 6, diffLineEnd: 6 });
        const { container } = render(
            <UnifiedDiffViewer
                diff={SIMPLE_DIFF}
                enableComments
                comments={[c]}
                onCommentClick={onCommentClick}
            />
        );
        const badge = container.querySelector<HTMLElement>('[data-testid="comment-badge"]')!;
        await act(async () => { fireEvent.click(badge); });
        expect(onCommentClick).toHaveBeenCalledOnce();
        expect(onCommentClick).toHaveBeenCalledWith(c, expect.objectContaining({ type: 'click' }));
    });

    it('badge has bg-yellow-400 class for open comment', () => {
        const comments = [makeComment({ diffLineStart: 6, diffLineEnd: 6, status: 'open' })];
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments comments={comments} />
        );
        const badge = container.querySelector<HTMLElement>('[data-testid="comment-badge"]')!;
        expect(badge.className).toContain('bg-yellow-400');
    });

    it('badge has bg-green-500 class for resolved comment', () => {
        const comments = [makeComment({ diffLineStart: 6, diffLineEnd: 6, status: 'resolved' })];
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments comments={comments} />
        );
        const badge = container.querySelector<HTMLElement>('[data-testid="comment-badge"]')!;
        expect(badge.className).toContain('bg-green-500');
    });

    it('line div includes yellow highlight class for open comment', () => {
        const comments = [makeComment({ diffLineStart: 6, diffLineEnd: 6, status: 'open' })];
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments comments={comments} />
        );
        const lineDiv = container.querySelector<HTMLElement>('[data-diff-line-index="6"]')!;
        expect(lineDiv.className).toContain('bg-[#fff9c4]');
    });

    it('line div includes green highlight and opacity-80 for resolved comment', () => {
        const comments = [makeComment({ diffLineStart: 6, diffLineEnd: 6, status: 'resolved' })];
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments comments={comments} />
        );
        const lineDiv = container.querySelector<HTMLElement>('[data-diff-line-index="6"]')!;
        expect(lineDiv.className).toContain('bg-[#e6ffed]');
        expect(lineDiv.className).toContain('opacity-80');
    });

    it('badge count reflects multiple comments on same line', () => {
        const c1 = makeComment({ id: 'c1', diffLineStart: 5, diffLineEnd: 7 });
        const c2 = makeComment({ id: 'c2', diffLineStart: 6, diffLineEnd: 6 });
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments comments={[c1, c2]} />
        );
        // Line 6 is covered by both c1 and c2
        const lineDiv = container.querySelector<HTMLElement>('[data-diff-line-index="6"]')!;
        const badge = lineDiv.querySelector<HTMLElement>('[data-testid="comment-badge"]')!;
        expect(badge.textContent).toBe('2');
    });

    it('no badge rendered for orphaned comment on a line', () => {
        const orphaned = { ...makeComment({ diffLineStart: 6, diffLineEnd: 6, status: 'open' }), status: 'orphaned' as any };
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments comments={[orphaned]} />
        );
        const lineDiv = container.querySelector<HTMLElement>('[data-diff-line-index="6"]')!;
        expect(lineDiv.querySelector('[data-testid="comment-badge"]')).toBeNull();
    });

    it('badge present for open comment when orphaned comment is also on same line', () => {
        const open = makeComment({ id: 'open', diffLineStart: 6, diffLineEnd: 6, status: 'open' });
        const orphaned = { ...makeComment({ id: 'orph', diffLineStart: 6, diffLineEnd: 6, status: 'open' }), status: 'orphaned' as any };
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments comments={[open, orphaned]} />
        );
        const lineDiv = container.querySelector<HTMLElement>('[data-diff-line-index="6"]')!;
        const badge = lineDiv.querySelector<HTMLElement>('[data-testid="comment-badge"]')!;
        // Only the open comment should count
        expect(badge).toBeTruthy();
        expect(badge.textContent).toBe('1');
    });
});

// ============================================================================
// UnifiedDiffViewer — line number alignment
// ============================================================================

describe('UnifiedDiffViewer — line number column alignment', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('line number spans have shrink-0 to prevent flex collapse', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} showLineNumbers data-testid="diff" />
        );
        // Collect all line-number gutter spans (w-8 columns) from content lines
        const allLines = container.querySelectorAll<HTMLElement>('.whitespace-pre-wrap');
        const gutterSpans: HTMLElement[] = [];
        allLines.forEach(line => {
            line.querySelectorAll<HTMLElement>('span').forEach(span => {
                if (span.className.includes('w-8')) {
                    gutterSpans.push(span);
                }
            });
        });
        expect(gutterSpans.length).toBeGreaterThan(0);
        for (const span of gutterSpans) {
            expect(span.className).toContain('shrink-0');
        }
    });

    it('line number spans have whitespace-nowrap to prevent wrapping onto two lines', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} showLineNumbers data-testid="diff" />
        );
        const allLines = container.querySelectorAll<HTMLElement>('.whitespace-pre-wrap');
        const gutterSpans: HTMLElement[] = [];
        allLines.forEach(line => {
            line.querySelectorAll<HTMLElement>('span').forEach(span => {
                if (span.className.includes('w-8')) {
                    gutterSpans.push(span);
                }
            });
        });
        expect(gutterSpans.length).toBeGreaterThan(0);
        for (const span of gutterSpans) {
            expect(span.className).toContain('whitespace-nowrap');
        }
    });

    it('removed line has same number of gutter spans as context line', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} showLineNumbers enableComments data-testid="diff" />
        );
        const removedLine = container.querySelector<HTMLElement>('[data-line-type="removed"]')!;
        const contextLine = container.querySelector<HTMLElement>('[data-line-type="context"]')!;
        expect(removedLine).toBeTruthy();
        expect(contextLine).toBeTruthy();

        const removedGutters = removedLine.querySelectorAll('span.select-none');
        const contextGutters = contextLine.querySelectorAll('span.select-none');
        expect(removedGutters.length).toBe(contextGutters.length);
    });

    it('added line has same number of gutter spans as context line', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} showLineNumbers enableComments data-testid="diff" />
        );
        const addedLine = container.querySelector<HTMLElement>('[data-line-type="added"]')!;
        const contextLine = container.querySelector<HTMLElement>('[data-line-type="context"]')!;
        expect(addedLine).toBeTruthy();
        expect(contextLine).toBeTruthy();

        const addedGutters = addedLine.querySelectorAll('span.select-none');
        const contextGutters = contextLine.querySelectorAll('span.select-none');
        expect(addedGutters.length).toBe(contextGutters.length);
    });
});

// ============================================================================
// UnifiedDiffViewer — no +/- prefix symbols
// ============================================================================

describe('UnifiedDiffViewer — diff prefix symbols hidden', () => {
    it('added line does not render a + prefix', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments data-testid="diff" />
        );
        const addedLine = container.querySelector<HTMLElement>('[data-line-type="added"]')!;
        expect(addedLine).toBeTruthy();
        expect(addedLine.textContent).not.toContain('+');
        expect(addedLine.textContent).toContain('new line');
    });

    it('removed line does not render a - prefix', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments data-testid="diff" />
        );
        const removedLine = container.querySelector<HTMLElement>('[data-line-type="removed"]')!;
        expect(removedLine).toBeTruthy();
        expect(removedLine.textContent).not.toContain('-');
        expect(removedLine.textContent).toContain('old line');
    });

    it('context line renders content without leading space prefix', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} enableComments data-testid="diff" />
        );
        const contextLine = container.querySelector<HTMLElement>('[data-line-type="context"]')!;
        expect(contextLine).toBeTruthy();
        expect(contextLine.textContent).toContain('context line');
    });
});

// ============================================================================
// UnifiedDiffViewer — word wrap default
// ============================================================================

describe('UnifiedDiffViewer — word wrap', () => {
    it('diff lines use whitespace-pre-wrap and break-words by default', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SIMPLE_DIFF} data-testid="diff" />
        );
        const contentLines = container.querySelectorAll<HTMLElement>('.whitespace-pre-wrap');
        expect(contentLines.length).toBeGreaterThan(0);
        for (const line of Array.from(contentLines)) {
            expect(line.className).toContain('break-words');
        }
        // No lines should use whitespace-pre (non-wrapping)
        const nonWrappedLines = container.querySelectorAll<HTMLElement>('.whitespace-pre:not(.whitespace-pre-wrap)');
        expect(nonWrappedLines.length).toBe(0);
    });
});
