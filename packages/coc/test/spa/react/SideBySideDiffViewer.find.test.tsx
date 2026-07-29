/**
 * SideBySideDiffViewer — in-diff Ctrl+F find integration (AC-02 / AC-03 split mode).
 *
 * Mirrors UnifiedDiffViewer.find.test.tsx for the two-column renderer: the split
 * viewer must overlay find-match ranges as <mark> on top of the syntax-highlighted
 * HTML (and the word-diff parts) in the correct column, emphasize the active match,
 * and `scrollLineIntoView` must drive the virtualizer so an off-screen (virtualized)
 * match on a windowed row becomes reachable. Virtualization mocks patch
 * offsetHeight/offsetWidth (what @tanstack/react-virtual measures), matching the
 * unified viewer's find test.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { createRef } from 'react';
import { SideBySideDiffViewer } from '../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer';
import { type UnifiedDiffViewerHandle } from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import {
    MATCH_HIGHLIGHT_CLASS,
    ACTIVE_MATCH_HIGHLIGHT_CLASS,
    type LineMatchRange,
} from '../../../src/server/spa/client/react/features/git/diff/diffFindModel';

/** A small single-file diff. Content lines begin at diff-line index 5. */
function smallDiff(): string {
    return [
        'diff --git a/a.ts b/a.ts',
        'index 1111111..2222222 100644',
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -1,3 +1,3 @@',
        ' const alpha = needle;',   // index 5, context — shown in BOTH columns
        '-const beta = 1;',          // index 6, removed → left column (word-diff)
        '+const beta = needle;',     // index 7, added → right column (word-diff)
    ].join('\n');
}

/** Build a large diff with `n` context lines in one hunk (>threshold). */
function largeDiff(n: number): string {
    const lines = [
        'diff --git a/big.ts b/big.ts',
        'index 1111111..2222222 100644',
        '--- a/big.ts',
        '+++ b/big.ts',
        `@@ -1,${n} +1,${n} @@`,
    ];
    for (let i = 0; i < n; i++) lines.push(` const contextValue${i} = ${i};`);
    return lines.join('\n');
}

function rangesOf(entries: [number, LineMatchRange[]][]): Map<number, LineMatchRange[]> {
    return new Map(entries);
}

function findMarks(container: HTMLElement) {
    return Array.from(container.querySelectorAll('mark'));
}

describe('SideBySideDiffViewer — find match overlay (eager path)', () => {
    it('overlays a <mark> with the match class on the hljs HTML for a context line', () => {
        // "const alpha = needle;" → "needle" at offsets 14..20 (context: both columns).
        const ranges = rangesOf([[5, [{ start: 14, end: 20, active: false }]]]);
        const { container } = render(
            <SideBySideDiffViewer diff={smallDiff()} fileName="a.ts" data-testid="diff" matchRangesByLine={ranges} />
        );
        // The context "needle" (index 5) is a find match in both columns. (Line 7's
        // word-diff mark also reads "needle" but carries the intra-line diff class,
        // not the find class — so key off the find class here.)
        const findMarks5 = findMarks(container)
            .filter(m => m.textContent === 'needle' && m.getAttribute('class') === MATCH_HIGHLIGHT_CLASS);
        expect(findMarks5.length).toBeGreaterThan(0);
    });

    it('emphasizes the active match with the active class', () => {
        const ranges = rangesOf([[5, [{ start: 14, end: 20, active: true }]]]);
        const { container } = render(
            <SideBySideDiffViewer diff={smallDiff()} fileName="a.ts" data-testid="diff" matchRangesByLine={ranges} />
        );
        const needleMark = findMarks(container).find(m => m.textContent === 'needle');
        expect(needleMark).toBeDefined();
        expect(needleMark!.getAttribute('class')).toBe(ACTIVE_MATCH_HIGHLIGHT_CLASS);
    });

    it('overlays matches on the word-diff (intra-line) render path in the right column', () => {
        // Line 7 "const beta = needle;" is paired with removed line 6 → word-diff
        // parts in the right column. "needle" is at offsets 13..19.
        const ranges = rangesOf([[7, [{ start: 13, end: 19, active: true }]]]);
        const { container } = render(
            <SideBySideDiffViewer diff={smallDiff()} fileName="a.ts" data-testid="diff" matchRangesByLine={ranges} />
        );
        const needleMark = findMarks(container).find(m => m.textContent === 'needle');
        expect(needleMark).toBeDefined();
        expect(needleMark!.getAttribute('class')).toContain(ACTIVE_MATCH_HIGHLIGHT_CLASS);
    });

    it('renders no find marks when no ranges are provided', () => {
        const { container } = render(
            <SideBySideDiffViewer diff={smallDiff()} fileName="a.ts" data-testid="diff" />
        );
        const findMark = findMarks(container)
            .find(m => (m.getAttribute('class') ?? '').includes(MATCH_HIGHLIGHT_CLASS)
                || (m.getAttribute('class') ?? '').includes(ACTIVE_MATCH_HIGHLIGHT_CLASS));
        expect(findMark).toBeUndefined();
    });
});

describe('SideBySideDiffViewer — scrollLineIntoView under virtualization', () => {
    let rectSpy: ReturnType<typeof vi.spyOn> | undefined;

    beforeEach(() => {
        rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}),
        } as DOMRect);
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 });
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 });
    });

    afterEach(() => {
        rectSpy?.mockRestore();
        const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
        delete proto.clientHeight;
        delete proto.offsetHeight;
        delete proto.offsetWidth;
        vi.restoreAllMocks();
    });

    function renderWindowed(ui: React.ReactElement) {
        const result = render(
            <div data-testid="scroller" style={{ overflowY: 'scroll', height: 600 }}>
                {ui}
            </div>
        );
        const scroller = result.container.querySelector('[data-testid="scroller"]') as HTMLElement;
        scroller.scrollTo = vi.fn();
        return { ...result, scroller };
    }

    it('drives a scroll toward an off-screen match line on the virtualized path', () => {
        const total = 20000;
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { scroller } = renderWindowed(
            <SideBySideDiffViewer ref={ref} diff={largeDiff(total)} fileName="big.ts" data-testid="diff" />
        );

        // A line far down the diff is not mounted (virtualized) — scrollLineIntoView
        // maps the diff-line index to its windowed row and drives the scroll parent.
        act(() => ref.current?.scrollLineIntoView(10005));
        expect(scroller.scrollTo).toHaveBeenCalled();
    });

    it('ignores line indices that map to no row', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { scroller } = renderWindowed(
            <SideBySideDiffViewer ref={ref} diff={largeDiff(1000)} fileName="big.ts" data-testid="diff" />
        );
        act(() => ref.current?.scrollLineIntoView(999999));
        expect(scroller.scrollTo).not.toHaveBeenCalled();
    });
});
