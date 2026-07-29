/**
 * UnifiedDiffViewer — in-diff Ctrl+F find integration (AC-02).
 *
 * Asserts that the viewer overlays find-match ranges as <mark> on top of the
 * syntax-highlighted HTML (and the word-diff parts), emphasizes the active
 * match distinctly, and that `scrollLineIntoView` drives the virtualizer so an
 * off-screen (virtualized) match becomes reachable. The virtualization mocks
 * mirror UnifiedDiffViewer.perf.test.tsx (offsetHeight/offsetWidth patched,
 * since @tanstack/react-virtual measures those, not getBoundingClientRect).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { createRef } from 'react';
import {
    UnifiedDiffViewer,
    type UnifiedDiffViewerHandle,
} from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
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
        ' const alpha = needle;',   // index 5, context — content "const alpha = needle;"
        '-const beta = 1;',          // index 6, removed
        '+const beta = needle;',     // index 7, added (paired → word-diff)
    ].join('\n');
}

/** Build a large diff with `n` content lines in one hunk (>threshold). */
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

describe('UnifiedDiffViewer — find match overlay (eager path)', () => {
    it('overlays a <mark> with the match class on the hljs HTML for a context line', () => {
        // "const alpha = needle;" → "needle" at offsets 14..20.
        const ranges = rangesOf([[5, [{ start: 14, end: 20, active: false }]]]);
        const { container } = render(
            <UnifiedDiffViewer diff={smallDiff()} fileName="a.ts" data-testid="diff" matchRangesByLine={ranges} />
        );
        const mark = container.querySelector('mark');
        expect(mark).not.toBeNull();
        expect(mark!.textContent).toBe('needle');
        expect(mark!.getAttribute('class')).toBe(MATCH_HIGHLIGHT_CLASS);
    });

    it('emphasizes the active match with the active class', () => {
        const ranges = rangesOf([[5, [{ start: 14, end: 20, active: true }]]]);
        const { container } = render(
            <UnifiedDiffViewer diff={smallDiff()} fileName="a.ts" data-testid="diff" matchRangesByLine={ranges} />
        );
        const mark = container.querySelector('mark');
        expect(mark!.getAttribute('class')).toBe(ACTIVE_MATCH_HIGHLIGHT_CLASS);
    });

    it('overlays matches on the word-diff (intra-line) render path', () => {
        // Line 7 "const beta = needle;" is paired with a removed line → word-diff
        // parts. "needle" is at offsets 13..19; the match must still render a mark.
        const ranges = rangesOf([[7, [{ start: 13, end: 19, active: true }]]]);
        const { container } = render(
            <UnifiedDiffViewer diff={smallDiff()} fileName="a.ts" data-testid="diff" matchRangesByLine={ranges} />
        );
        const marks = Array.from(container.querySelectorAll('mark'));
        const needleMark = marks.find(m => m.textContent === 'needle');
        expect(needleMark).toBeDefined();
        expect(needleMark!.getAttribute('class')).toContain(ACTIVE_MATCH_HIGHLIGHT_CLASS);
    });

    it('renders no find marks when no ranges are provided', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={smallDiff()} fileName="a.ts" data-testid="diff" />
        );
        const findMark = Array.from(container.querySelectorAll('mark'))
            .find(m => (m.getAttribute('class') ?? '').includes(MATCH_HIGHLIGHT_CLASS)
                || (m.getAttribute('class') ?? '').includes(ACTIVE_MATCH_HIGHLIGHT_CLASS));
        expect(findMark).toBeUndefined();
    });
});

describe('UnifiedDiffViewer — scrollLineIntoView under virtualization', () => {
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
            <UnifiedDiffViewer ref={ref} diff={largeDiff(total)} fileName="big.ts" data-testid="diff" />
        );

        // A line far down the diff is not mounted (virtualized), so native find
        // could never reach it — scrollLineIntoView must drive the scroll parent.
        act(() => ref.current?.scrollLineIntoView(10005));
        expect(scroller.scrollTo).toHaveBeenCalled();
    });

    it('ignores out-of-range line indices', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { scroller } = renderWindowed(
            <UnifiedDiffViewer ref={ref} diff={largeDiff(1000)} fileName="big.ts" data-testid="diff" />
        );
        act(() => ref.current?.scrollLineIntoView(999999));
        expect(scroller.scrollTo).not.toHaveBeenCalled();
    });
});
