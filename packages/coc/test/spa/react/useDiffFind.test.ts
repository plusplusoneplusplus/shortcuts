/**
 * Tests for useDiffFind — the state hook behind the in-diff Ctrl+F find widget.
 *
 * These cover the search-state contract independent of the viewers: match
 * counting across multiple files, the case-sensitivity toggle, next/prev
 * wrap-around, active-match reset on a new query, Esc-close clearing highlights,
 * and the scroll-into-view callback firing for the active (possibly off-screen)
 * match.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useDiffFind } from '../../../src/server/spa/client/react/features/git/diff/useDiffFind';
import { computeDiffLines } from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';

// A two-file unified diff. "Widget" appears once in a.ts (added) and once in
// b.ts (context), so a case-insensitive search for "widget" yields 2 matches
// across files; case-sensitive "Widget" also yields 2, "widget" yields 0.
const DIFF = [
    'diff --git a/a.ts b/a.ts',
    'index 1111111..2222222 100644',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,2 +1,3 @@',
    ' const untouched = 1;',
    '+const Widget = makeWidget();',
    ' const tail = 2;',
    'diff --git a/b.ts b/b.ts',
    'index 3333333..4444444 100644',
    '--- a/b.ts',
    '+++ b/b.ts',
    '@@ -1,1 +1,1 @@',
    ' export const Widget = null;',
].join('\n');

const diffLines = computeDiffLines(DIFF.split('\n'));

describe('useDiffFind', () => {
    it('counts case-insensitive matches across multiple files', () => {
        const { result } = renderHook(() => useDiffFind(diffLines));
        act(() => result.current.setQuery('widget'));
        // "Widget" in a.ts + "Widget" in b.ts, plus "makeWidget" in a.ts = 3.
        expect(result.current.matchCount).toBe(3);
        expect(result.current.activeIndex).toBe(0);
    });

    it('respects the case-sensitivity toggle', () => {
        const { result } = renderHook(() => useDiffFind(diffLines));
        act(() => result.current.setQuery('widget'));
        act(() => result.current.toggleCaseSensitive());
        // Only lower-case "widget" — none exist (all are "Widget"/"makeWidget").
        expect(result.current.caseSensitive).toBe(true);
        expect(result.current.matchCount).toBe(0);
        expect(result.current.activeIndex).toBe(-1);

        act(() => result.current.setQuery('Widget'));
        // "Widget" (a.ts), "Widget" (makeWidget a.ts), "Widget" (b.ts) = 3.
        expect(result.current.matchCount).toBe(3);
    });

    it('wraps forward and backward through matches', () => {
        const { result } = renderHook(() => useDiffFind(diffLines));
        act(() => result.current.setQuery('widget'));
        expect(result.current.activeIndex).toBe(0);

        act(() => result.current.goToNext());
        expect(result.current.activeIndex).toBe(1);
        act(() => result.current.goToNext());
        expect(result.current.activeIndex).toBe(2);
        act(() => result.current.goToNext());
        expect(result.current.activeIndex).toBe(0); // wrapped

        act(() => result.current.goToPrev());
        expect(result.current.activeIndex).toBe(2); // wrapped backward
    });

    it('resets the active match to the first hit on a new query', () => {
        const { result } = renderHook(() => useDiffFind(diffLines));
        act(() => result.current.setQuery('widget'));
        act(() => result.current.goToNext());
        expect(result.current.activeIndex).toBe(1);
        act(() => result.current.setQuery('const'));
        expect(result.current.activeIndex).toBe(0);
    });

    it('flags the active match in matchRangesByLine', () => {
        const { result } = renderHook(() => useDiffFind(diffLines));
        act(() => result.current.setQuery('widget'));
        const flatActive = Array.from(result.current.matchRangesByLine.values())
            .flat()
            .filter(r => r.active);
        expect(flatActive).toHaveLength(1);
    });

    it('opens and closes, clearing the query on Esc-close', () => {
        const { result } = renderHook(() => useDiffFind(diffLines));
        act(() => result.current.openFind());
        act(() => result.current.setQuery('widget'));
        expect(result.current.open).toBe(true);
        expect(result.current.matchCount).toBe(3);

        act(() => result.current.closeFind());
        expect(result.current.open).toBe(false);
        expect(result.current.query).toBe('');
        expect(result.current.matchCount).toBe(0);
        expect(result.current.matchRangesByLine.size).toBe(0);
    });

    it('scrolls the active match into view only while open', () => {
        const onScrollToLine = vi.fn();
        const { result } = renderHook(() => useDiffFind(diffLines, onScrollToLine));

        // Closed: setting a query must not scroll.
        act(() => result.current.setQuery('widget'));
        expect(onScrollToLine).not.toHaveBeenCalled();

        // Open: the active (first) match scrolls into view.
        act(() => result.current.openFind());
        expect(onScrollToLine).toHaveBeenCalledTimes(1);
        const firstLine = result.current.matches[0].lineIndex;
        expect(onScrollToLine).toHaveBeenLastCalledWith(firstLine);

        // Navigating scrolls the new active match into view.
        onScrollToLine.mockClear();
        act(() => result.current.goToNext());
        const secondLine = result.current.matches[1].lineIndex;
        expect(onScrollToLine).toHaveBeenLastCalledWith(secondLine);
    });
});
