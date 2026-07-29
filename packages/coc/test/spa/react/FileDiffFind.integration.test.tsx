/**
 * In-diff Ctrl+F find — integration / Definition-of-Done coverage (AC-01/02/03).
 *
 * These tests wire the real find stack together the same way FileDiffPanel does
 * — `useDiffFind` (full-model search + scroll delegation) + `DiffFindWidget`
 * (the overlay) + a real diff viewer (`UnifiedDiffViewer` or
 * `SideBySideDiffViewer`) + `useDiffFindShortcut` (Ctrl/Cmd+F ownership) — but
 * without FileDiffPanel's heavy fetch/queue/comments dependencies. The harness
 * mirrors the host contract: the viewer reports its parsed model via
 * `onLinesReady`, that model drives `useDiffFind`, and the resulting
 * `matchRangesByLine` flows back into the viewer while the widget's scroll
 * callback is routed to the viewer's `scrollLineIntoView` handle.
 *
 * The virtualization block mocks `offsetHeight`/`offsetWidth` (which
 * @tanstack/react-virtual measures — not `getBoundingClientRect`) exactly like
 * UnifiedDiffViewer.find.test.tsx, so an off-screen match in a >500-line file is
 * still counted in "N of M" and its row is scrolled into range.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';
import { UnifiedDiffViewer } from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import type {
    UnifiedDiffViewerHandle,
    DiffLine,
} from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import { SideBySideDiffViewer } from '../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer';
import { DiffFindWidget } from '../../../src/server/spa/client/react/features/git/diff/DiffFindWidget';
import { useDiffFind } from '../../../src/server/spa/client/react/features/git/diff/useDiffFind';
import { useDiffFindShortcut } from '../../../src/server/spa/client/react/features/git/diff/useDiffFindShortcut';
import {
    MATCH_HIGHLIGHT_CLASS,
    ACTIVE_MATCH_HIGHLIGHT_CLASS,
} from '../../../src/server/spa/client/react/features/git/diff/diffFindModel';

afterEach(cleanup);

// jsdom does not implement Element.scrollTo; the viewer's scrollLineIntoView
// calls it on the scroll parent. Provide a no-op default (individual tests may
// still install a spy on a specific element to assert the scroll happened).
beforeEach(() => {
    if (!HTMLElement.prototype.scrollTo) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
            configurable: true,
            writable: true,
            value: () => {},
        });
    }
});

// ── Diff fixtures ──────────────────────────────────────────────────────────

/** Single-file diff whose context line contains "needle" twice. */
function twoHitDiff(): string {
    return [
        'diff --git a/a.ts b/a.ts',
        'index 1111111..2222222 100644',
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -1,2 +1,2 @@',
        ' const needle = needle;', // two "needle" hits on one content line
        '+const other = 1;',
    ].join('\n');
}

/** Two-file diff; each file has one "Needle" (capital N) content line. */
function multiFileDiff(): string {
    return [
        'diff --git a/one.ts b/one.ts',
        'index 1111111..2222222 100644',
        '--- a/one.ts',
        '+++ b/one.ts',
        '@@ -1,1 +1,1 @@',
        '+const one = Needle;',
        'diff --git a/two.ts b/two.ts',
        'index 3333333..4444444 100644',
        '--- a/two.ts',
        '+++ b/two.ts',
        '@@ -1,1 +1,1 @@',
        '+const two = needle;', // lowercase — only matches when case-insensitive
    ].join('\n');
}

/**
 * A >VIRTUALIZE_THRESHOLD diff (windowed) whose ONLY occurrence of the token
 * `farNeedle` sits far down the file, well past the mounted viewport rows.
 */
function largeDiffWithFarMatch(total: number, matchAt: number): string {
    const lines = [
        'diff --git a/big.ts b/big.ts',
        'index 1111111..2222222 100644',
        '--- a/big.ts',
        '+++ b/big.ts',
        `@@ -1,${total} +1,${total} @@`,
    ];
    for (let i = 0; i < total; i++) {
        lines.push(i === matchAt ? ` const farNeedle = ${i};` : ` const contextValue${i} = ${i};`);
    }
    return lines.join('\n');
}

// ── Harness: mirrors FileDiffPanel's find wiring, minus the fetch layer ──────

interface HarnessProps {
    diff: string;
    fileName?: string;
    mode?: 'unified' | 'split';
}

/**
 * Renders the diff + find widget wired exactly as FileDiffPanel wires them.
 * A test-only "open find" button stands in for the several host entry points
 * (Ctrl+F / toolbar) so tests that aren't exercising the shortcut can open the
 * widget deterministically.
 */
function FindHarness({ diff, fileName = 'a.ts', mode = 'unified' }: HarnessProps) {
    const viewerRef = useRef<UnifiedDiffViewerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);

    const scrollActiveMatchIntoView = useCallback((lineIndex: number) => {
        viewerRef.current?.scrollLineIntoView(lineIndex);
    }, []);
    const find = useDiffFind(diffLines, scrollActiveMatchIntoView);
    useDiffFindShortcut(scrollContainerRef, find.openFind);

    const Viewer = mode === 'split' ? SideBySideDiffViewer : UnifiedDiffViewer;

    return (
        <div className="relative">
            <button data-testid="harness-open-find" onClick={find.openFind}>open</button>
            {find.open && (
                <DiffFindWidget
                    query={find.query}
                    caseSensitive={find.caseSensitive}
                    matchCount={find.matchCount}
                    activeIndex={find.activeIndex}
                    onQueryChange={find.setQuery}
                    onToggleCaseSensitive={find.toggleCaseSensitive}
                    onNext={find.goToNext}
                    onPrev={find.goToPrev}
                    onClose={find.closeFind}
                />
            )}
            <div
                ref={scrollContainerRef}
                data-testid="file-diff-section"
                tabIndex={-1}
                // Inline overflow so getScrollableAncestor (reads computed
                // overflowY) resolves this element as the virtualizer scroll parent.
                style={{ overflowY: 'scroll', height: 600 }}
            >
                <Viewer
                    ref={viewerRef}
                    diff={diff}
                    fileName={fileName}
                    onLinesReady={setDiffLines}
                    matchRangesByLine={find.matchRangesByLine}
                    data-testid="diff"
                />
            </div>
        </div>
    );
}

/** Make the diff container report a truthy offsetParent (jsdom returns null). */
function makeVisible(el: HTMLElement) {
    Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => el.parentElement });
}

function findMarks(container: HTMLElement) {
    return Array.from(container.querySelectorAll('mark')).filter(m => {
        const cls = m.getAttribute('class') ?? '';
        return cls.includes(MATCH_HIGHLIGHT_CLASS) || cls.includes(ACTIVE_MATCH_HIGHLIGHT_CLASS);
    });
}

// ── AC-01 / AC-03: widget, counting, navigation, case toggle, Esc ────────────

describe('in-diff find — widget + navigation (eager, non-virtualized)', () => {
    it('counts all matches on a single content line ("N of M")', () => {
        const { getByTestId } = render(<FindHarness diff={twoHitDiff()} />);
        fireEvent.click(getByTestId('harness-open-find'));
        fireEvent.change(getByTestId('diff-find-input'), { target: { value: 'needle' } });

        expect(getByTestId('diff-find-count').textContent).toBe('1 of 2');
    });

    it('counts matches across multiple files in the diff model', () => {
        const { getByTestId } = render(<FindHarness diff={multiFileDiff()} fileName="one.ts" />);
        fireEvent.click(getByTestId('harness-open-find'));
        // Case-insensitive: "Needle" (file 1) + "needle" (file 2) = 2 hits.
        fireEvent.change(getByTestId('diff-find-input'), { target: { value: 'needle' } });

        expect(getByTestId('diff-find-count').textContent).toBe('1 of 2');
    });

    it('case-sensitivity toggle updates the match set and counter', () => {
        const { getByTestId } = render(<FindHarness diff={multiFileDiff()} fileName="one.ts" />);
        fireEvent.click(getByTestId('harness-open-find'));
        fireEvent.change(getByTestId('diff-find-input'), { target: { value: 'Needle' } });
        expect(getByTestId('diff-find-count').textContent).toBe('1 of 2');

        // Case-sensitive: only the capital-N "Needle" in file 1 survives.
        fireEvent.click(getByTestId('diff-find-case-toggle'));
        expect(getByTestId('diff-find-count').textContent).toBe('1 of 1');
    });

    it('next/prev cycle through matches in document order and wrap at the ends', () => {
        const { getByTestId } = render(<FindHarness diff={twoHitDiff()} />);
        fireEvent.click(getByTestId('harness-open-find'));
        const input = getByTestId('diff-find-input');
        fireEvent.change(input, { target: { value: 'needle' } });
        expect(getByTestId('diff-find-count').textContent).toBe('1 of 2');

        // Enter → next.
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(getByTestId('diff-find-count').textContent).toBe('2 of 2');
        // Enter at the end wraps back to the first.
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(getByTestId('diff-find-count').textContent).toBe('1 of 2');
        // Shift+Enter → previous wraps to the last.
        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
        expect(getByTestId('diff-find-count').textContent).toBe('2 of 2');
    });

    it('shows "No results" for a non-empty query with no matches', () => {
        const { getByTestId } = render(<FindHarness diff={twoHitDiff()} />);
        fireEvent.click(getByTestId('harness-open-find'));
        fireEvent.change(getByTestId('diff-find-input'), { target: { value: 'zzznope' } });
        expect(getByTestId('diff-find-count').textContent).toBe('No results');
    });

    it('emphasizes exactly one active match distinctly from the rest', () => {
        const { container, getByTestId } = render(<FindHarness diff={twoHitDiff()} />);
        fireEvent.click(getByTestId('harness-open-find'));
        fireEvent.change(getByTestId('diff-find-input'), { target: { value: 'needle' } });

        const marks = findMarks(container);
        expect(marks.length).toBe(2);
        const active = marks.filter(m => (m.getAttribute('class') ?? '').includes(ACTIVE_MATCH_HIGHLIGHT_CLASS));
        expect(active.length).toBe(1);
    });

    it('Esc closes the widget and clears all match highlights', () => {
        const { container, getByTestId, queryByTestId } = render(<FindHarness diff={twoHitDiff()} />);
        fireEvent.click(getByTestId('harness-open-find'));
        const input = getByTestId('diff-find-input');
        fireEvent.change(input, { target: { value: 'needle' } });
        expect(findMarks(container).length).toBe(2);

        fireEvent.keyDown(input, { key: 'Escape' });
        expect(queryByTestId('diff-find-widget')).toBeNull();
        expect(findMarks(container).length).toBe(0);
    });
});

// ── AC-01: Ctrl+F ownership at the integration level ─────────────────────────

describe('in-diff find — Ctrl+F opens the widget when focus is in the diff', () => {
    it('opens the widget and prevents default on Ctrl+F inside the diff container', () => {
        const { getByTestId, queryByTestId } = render(<FindHarness diff={twoHitDiff()} />);
        const section = getByTestId('file-diff-section');
        makeVisible(section);
        expect(queryByTestId('diff-find-widget')).toBeNull();

        const evt = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
        act(() => { section.dispatchEvent(evt); });

        expect(evt.defaultPrevented).toBe(true);
        expect(queryByTestId('diff-find-widget')).not.toBeNull();
    });

    it('stays inert (native find wins, widget stays closed) when focus is outside the diff', () => {
        const { getByTestId, queryByTestId } = render(<FindHarness diff={twoHitDiff()} />);
        const section = getByTestId('file-diff-section');
        makeVisible(section);

        // A node outside the diff container.
        const outside = getByTestId('harness-open-find');
        const evt = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
        act(() => { outside.dispatchEvent(evt); });

        expect(evt.defaultPrevented).toBe(false);
        expect(queryByTestId('diff-find-widget')).toBeNull();
    });
});

// ── AC-02: virtualized off-screen match counted + scrolled into view ─────────

describe('in-diff find — virtualized diff (>500 lines)', () => {
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

    it('counts an off-screen match and scrolls its row into range', () => {
        // Content lines start at diff-line index 5; the match sits ~10000 rows
        // down, far past the mounted viewport → native find could never reach it.
        const total = 20000;
        const matchAt = 10000;
        const { getByTestId } = render(
            <FindHarness diff={largeDiffWithFarMatch(total, matchAt)} fileName="big.ts" />
        );
        const section = getByTestId('file-diff-section');
        const scrollSpy = vi.fn();
        section.scrollTo = scrollSpy;

        act(() => { fireEvent.click(getByTestId('harness-open-find')); });
        act(() => {
            fireEvent.change(getByTestId('diff-find-input'), { target: { value: 'farNeedle' } });
        });

        // The off-screen match is found in the full model despite virtualization.
        expect(getByTestId('diff-find-count').textContent).toBe('1 of 1');
        // And the active match drove the virtualizer to scroll toward its row.
        expect(scrollSpy).toHaveBeenCalled();
    });
});

// ── AC-03: side-by-side mode has find parity ─────────────────────────────────

describe('in-diff find — side-by-side viewer parity', () => {
    it('counts and highlights matches in split mode', () => {
        const { container, getByTestId } = render(<FindHarness diff={twoHitDiff()} mode="split" />);
        fireEvent.click(getByTestId('harness-open-find'));
        fireEvent.change(getByTestId('diff-find-input'), { target: { value: 'needle' } });

        expect(getByTestId('diff-find-count').textContent).toBe('1 of 2');
        // Split mode renders the same content line in the left column → 2 marks.
        expect(findMarks(container).length).toBeGreaterThanOrEqual(2);
    });
});
