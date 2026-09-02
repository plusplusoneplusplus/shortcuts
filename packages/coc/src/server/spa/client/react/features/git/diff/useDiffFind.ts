/**
 * useDiffFind — state hook for the in-diff Ctrl+F find widget.
 *
 * Owns the ephemeral find UI state (open, query, case-sensitivity, active match)
 * and derives the match set from the *full* diff model via `diffFindModel`, so it
 * finds off-screen matches in virtualized diffs (files over VIRTUALIZE_THRESHOLD
 * lines) that the native browser find cannot see. It is deliberately decoupled
 * from the viewers: scrolling the active match into view is delegated to the
 * injected `onScrollToLine` callback (wired to the viewer's imperative handle),
 * and highlighting is exposed as `matchRangesByLine` for the row renderer.
 *
 * No persistent state is written — the query and options live only in memory.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffLine } from './UnifiedDiffViewer';
import {
    computeDiffMatches,
    groupMatchesByLine,
    nextMatchIndex,
    prevMatchIndex,
    type DiffMatch,
    type LineMatchRange,
} from './diffFindModel';

export interface UseDiffFindResult {
    open: boolean;
    /** Current search query (raw, un-normalized). */
    query: string;
    /** Whether matching is case-sensitive (default false). */
    caseSensitive: boolean;
    /** All matches across the full diff model, in document order. */
    matches: DiffMatch[];
    /** Index into `matches` of the active match, or -1 when there are none. */
    activeIndex: number;
    /** Total match count (`matches.length`), for the "N of M" counter. */
    matchCount: number;
    /** Per-line highlight ranges (with the active match flagged) for the renderer. */
    matchRangesByLine: Map<number, LineMatchRange[]>;
    /** Open the widget. Existing query/options are preserved. */
    openFind: () => void;
    /** Close the widget and clear the query so all highlights disappear. */
    closeFind: () => void;
    /** Replace the query; the active match resets to the first hit. */
    setQuery: (query: string) => void;
    /** Toggle case-sensitivity; the match set + active match recompute. */
    toggleCaseSensitive: () => void;
    /** Advance to the next match (wraps at the end). */
    goToNext: () => void;
    /** Step to the previous match (wraps at the start). */
    goToPrev: () => void;
}

/**
 * @param diffLines The full parsed diff model (all files of the current review).
 * @param onScrollToLine Called with the diff-line index of the active match
 *   whenever it changes, so the host can scroll it into view (drives the
 *   virtualizer for off-screen rows). Kept in a ref so callers may pass an
 *   inline closure without churning the scroll effect.
 */
export function useDiffFind(
    diffLines: DiffLine[],
    onScrollToLine?: (lineIndex: number) => void,
): UseDiffFindResult {
    const [open, setOpen] = useState(false);
    const [query, setQueryState] = useState('');
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);

    const matches = useMemo(
        () => computeDiffMatches(diffLines, query, caseSensitive),
        [diffLines, query, caseSensitive],
    );

    // Reset the active match to the first hit whenever the match set changes
    // (new query, case toggle, or a reloaded diff). Next/prev change activeIndex
    // without changing `matches`, so they do not trigger this reset.
    useEffect(() => {
        setActiveIndex(matches.length > 0 ? 0 : -1);
    }, [matches]);

    // Scroll the active match into view. Latest-ref so an inline onScrollToLine
    // closure does not re-fire this effect on every parent render.
    const onScrollToLineRef = useRef(onScrollToLine);
    useEffect(() => { onScrollToLineRef.current = onScrollToLine; });

    useEffect(() => {
        if (!open) return;
        if (activeIndex < 0 || activeIndex >= matches.length) return;
        onScrollToLineRef.current?.(matches[activeIndex].lineIndex);
    }, [open, activeIndex, matches]);

    const matchRangesByLine = useMemo(
        () => groupMatchesByLine(matches, activeIndex),
        [matches, activeIndex],
    );

    const openFind = useCallback(() => setOpen(true), []);

    const closeFind = useCallback(() => {
        setOpen(false);
        // Clear the query so match highlights disappear on Esc (AC-01).
        setQueryState('');
        setActiveIndex(-1);
    }, []);

    const setQuery = useCallback((next: string) => {
        setQueryState(next);
    }, []);

    const toggleCaseSensitive = useCallback(() => {
        setCaseSensitive(v => !v);
    }, []);

    const goToNext = useCallback(() => {
        setActiveIndex(cur => nextMatchIndex(cur, matches.length));
    }, [matches.length]);

    const goToPrev = useCallback(() => {
        setActiveIndex(cur => prevMatchIndex(cur, matches.length));
    }, [matches.length]);

    return {
        open,
        query,
        caseSensitive,
        matches,
        activeIndex,
        matchCount: matches.length,
        matchRangesByLine,
        openFind,
        closeFind,
        setQuery,
        toggleCaseSensitive,
        goToNext,
        goToPrev,
    };
}
