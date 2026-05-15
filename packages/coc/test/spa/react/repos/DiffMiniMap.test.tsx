/**
 * DiffMiniMap — comprehensive tests.
 *
 * Covers segment building, rendering, click navigation, viewport indicator,
 * drag scrolling, visibility conditions, pixel-based alignment, and edge cases.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
    DiffMiniMap,
    buildDiffSegments,
    getSegmentColor,
    measureLineOffsets,
    computeSegmentPositions,
    MINIMAP_WIDTH,
    type DiffSegment,
    type LineOffset,
} from '../../../../src/server/spa/client/react/features/git/diff/DiffMiniMap';
import type { DiffLine } from '../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';

// ── Helpers ────────────────────────────────────────────────────────────

function makeLine(type: DiffLine['type'], index: number): DiffLine {
    return { index, type, content: `${type} line ${index}` };
}

function makeLines(types: DiffLine['type'][]): DiffLine[] {
    return types.map((type, i) => makeLine(type, i));
}

function createScrollContainer(options?: {
    lineHeights?: number[];
}): HTMLDivElement {
    const el = document.createElement('div');
    const lineHeights = options?.lineHeights;

    // If custom line heights are provided, create child elements with
    // data-diff-line-index and mock their bounding rects.
    if (lineHeights) {
        let cumulativeTop = 0;
        const totalHeight = lineHeights.reduce((a, b) => a + b, 0);

        for (let i = 0; i < lineHeights.length; i++) {
            const lineEl = document.createElement('div');
            lineEl.setAttribute('data-diff-line-index', String(i));
            const top = cumulativeTop;
            const height = lineHeights[i];
            vi.spyOn(lineEl, 'getBoundingClientRect').mockReturnValue({
                top, left: 0, width: 100, height,
                bottom: top + height, right: 100, x: 0, y: 0, toJSON: () => {},
            });
            el.appendChild(lineEl);
            cumulativeTop += height;
        }

        Object.defineProperties(el, {
            scrollHeight: { value: totalHeight, configurable: true },
            clientHeight: { value: Math.min(500, totalHeight), configurable: true },
            scrollTop: { value: 0, writable: true, configurable: true },
        });
        vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
            top: 0, left: 0, width: 100, height: Math.min(500, totalHeight),
            bottom: Math.min(500, totalHeight), right: 100, x: 0, y: 0, toJSON: () => {},
        });
    } else {
        Object.defineProperties(el, {
            scrollHeight: { value: 2000, configurable: true },
            clientHeight: { value: 500, configurable: true },
            scrollTop: { value: 0, writable: true, configurable: true },
        });
    }

    el.scrollTo = vi.fn((opts?: ScrollToOptions) => {
        if (opts?.top !== undefined) (el as any).scrollTop = opts.top;
    });
    return el;
}

function renderMiniMap(options: {
    diffLines?: DiffLine[];
    scrollContainer?: HTMLDivElement;
} = {}) {
    const diffLines = options.diffLines ?? makeLines([
        'meta', 'meta', 'meta', 'meta',
        'hunk-header',
        'removed', 'removed',
        'added', 'added', 'added',
        'context', 'context',
    ]);
    const scrollContainer = options.scrollContainer ?? createScrollContainer();
    const scrollRef = { current: scrollContainer };

    const result = render(
        <DiffMiniMap
            diffLines={diffLines}
            scrollContainerRef={scrollRef}
        />
    );

    return { ...result, scrollContainer, scrollRef };
}

// ── Pure function tests ────────────────────────────────────────────────

describe('buildDiffSegments', () => {
    it('returns empty array for empty input', () => {
        expect(buildDiffSegments([])).toEqual([]);
    });

    it('groups single line into one segment', () => {
        const lines = makeLines(['added']);
        const segments = buildDiffSegments(lines);
        expect(segments).toEqual([{ type: 'added', startLine: 0, lineCount: 1 }]);
    });

    it('groups consecutive same-type lines', () => {
        const lines = makeLines(['added', 'added', 'added']);
        const segments = buildDiffSegments(lines);
        expect(segments).toEqual([{ type: 'added', startLine: 0, lineCount: 3 }]);
    });

    it('splits different-type lines into separate segments', () => {
        const lines = makeLines(['context', 'removed', 'added']);
        const segments = buildDiffSegments(lines);
        expect(segments).toHaveLength(3);
        expect(segments[0]).toEqual({ type: 'context', startLine: 0, lineCount: 1 });
        expect(segments[1]).toEqual({ type: 'removed', startLine: 1, lineCount: 1 });
        expect(segments[2]).toEqual({ type: 'added', startLine: 2, lineCount: 1 });
    });

    it('handles typical diff structure: meta + hunk + changes + context', () => {
        const lines = makeLines([
            'meta', 'meta', 'meta', 'meta',
            'hunk-header',
            'removed', 'removed',
            'added', 'added', 'added',
            'context', 'context', 'context',
        ]);
        const segments = buildDiffSegments(lines);
        expect(segments).toHaveLength(5);
        expect(segments[0]).toEqual({ type: 'meta', startLine: 0, lineCount: 4 });
        expect(segments[1]).toEqual({ type: 'hunk-header', startLine: 4, lineCount: 1 });
        expect(segments[2]).toEqual({ type: 'removed', startLine: 5, lineCount: 2 });
        expect(segments[3]).toEqual({ type: 'added', startLine: 7, lineCount: 3 });
        expect(segments[4]).toEqual({ type: 'context', startLine: 10, lineCount: 3 });
    });

    it('handles alternating types', () => {
        const lines = makeLines(['added', 'removed', 'added', 'removed']);
        const segments = buildDiffSegments(lines);
        expect(segments).toHaveLength(4);
        expect(segments.map(s => s.type)).toEqual(['added', 'removed', 'added', 'removed']);
    });
});

describe('getSegmentColor', () => {
    it('returns added color for added type', () => {
        expect(getSegmentColor('added')).toBe('var(--diff-minimap-added)');
    });

    it('returns removed color for removed type', () => {
        expect(getSegmentColor('removed')).toBe('var(--diff-minimap-removed)');
    });

    it('returns transparent for context type', () => {
        expect(getSegmentColor('context')).toBe('transparent');
    });

    it('returns transparent for meta type', () => {
        expect(getSegmentColor('meta')).toBe('transparent');
    });

    it('returns transparent for hunk-header type', () => {
        expect(getSegmentColor('hunk-header')).toBe('transparent');
    });
});

// ── Pixel measurement tests ────────────────────────────────────────────

describe('measureLineOffsets', () => {
    it('returns empty offsets when no data-diff-line-index elements exist', () => {
        const container = document.createElement('div');
        Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
        vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
            top: 0, left: 0, width: 100, height: 500,
            bottom: 500, right: 100, x: 0, y: 0, toJSON: () => {},
        });

        const { offsets, totalHeight } = measureLineOffsets(container);
        expect(offsets).toEqual([]);
        expect(totalHeight).toBe(1000);
    });

    it('measures uniform-height lines correctly', () => {
        const container = createScrollContainer({
            lineHeights: [20, 20, 20, 20, 20],
        });

        const { offsets, totalHeight } = measureLineOffsets(container);
        expect(offsets).toHaveLength(5);
        expect(offsets[0]).toEqual({ top: 0, height: 20 });
        expect(offsets[1]).toEqual({ top: 20, height: 20 });
        expect(offsets[4]).toEqual({ top: 80, height: 20 });
        expect(totalHeight).toBe(100);
    });

    it('measures wrapped (variable-height) lines correctly', () => {
        // Simulate a line that wraps to 3 visual rows (60px) vs normal 20px
        const container = createScrollContainer({
            lineHeights: [20, 20, 60, 20, 20],
        });

        const { offsets, totalHeight } = measureLineOffsets(container);
        expect(offsets).toHaveLength(5);
        expect(offsets[0]).toEqual({ top: 0, height: 20 });
        expect(offsets[1]).toEqual({ top: 20, height: 20 });
        expect(offsets[2]).toEqual({ top: 40, height: 60 }); // wrapped line
        expect(offsets[3]).toEqual({ top: 100, height: 20 });
        expect(offsets[4]).toEqual({ top: 120, height: 20 });
        expect(totalHeight).toBe(140);
    });
});

describe('computeSegmentPositions', () => {
    it('returns zero positions when totalHeight is zero', () => {
        const segments: DiffSegment[] = [
            { type: 'added', startLine: 0, lineCount: 2 },
        ];
        const result = computeSegmentPositions(segments, [], 0);
        expect(result).toEqual([{ topPercent: 0, heightPercent: 0 }]);
    });

    it('computes correct percentages for uniform-height lines', () => {
        const offsets: LineOffset[] = [
            { top: 0, height: 20 },
            { top: 20, height: 20 },
            { top: 40, height: 20 },
            { top: 60, height: 20 },
        ];
        const segments: DiffSegment[] = [
            { type: 'context', startLine: 0, lineCount: 2 },
            { type: 'added', startLine: 2, lineCount: 2 },
        ];
        const result = computeSegmentPositions(segments, offsets, 80);

        expect(result[0].topPercent).toBe(0);
        expect(result[0].heightPercent).toBe(50);
        expect(result[1].topPercent).toBe(50);
        expect(result[1].heightPercent).toBe(50);
    });

    it('accounts for wrapped lines taking more pixel space', () => {
        // Line 1 is a wrapped line that is 60px tall
        const offsets: LineOffset[] = [
            { top: 0, height: 20 },   // line 0: normal
            { top: 20, height: 60 },  // line 1: wrapped (3x height)
            { top: 80, height: 20 },  // line 2: normal
        ];
        const segments: DiffSegment[] = [
            { type: 'context', startLine: 0, lineCount: 1 },
            { type: 'added', startLine: 1, lineCount: 1 },   // the wrapped line
            { type: 'context', startLine: 2, lineCount: 1 },
        ];
        const result = computeSegmentPositions(segments, offsets, 100);

        // The 'added' segment should take 60% (60px / 100px), not 33%
        expect(result[0]).toEqual({ topPercent: 0, heightPercent: 20 });
        expect(result[1]).toEqual({ topPercent: 20, heightPercent: 60 });
        expect(result[2]).toEqual({ topPercent: 80, heightPercent: 20 });
    });

    it('handles startLine beyond lineOffsets range', () => {
        const offsets: LineOffset[] = [
            { top: 0, height: 20 },
        ];
        const segments: DiffSegment[] = [
            { type: 'added', startLine: 5, lineCount: 1 },
        ];
        const result = computeSegmentPositions(segments, offsets, 100);
        expect(result[0].topPercent).toBe(100);
    });
});

// ── Component rendering tests ──────────────────────────────────────────

describe('DiffMiniMap', () => {
    let rafCallbacks: FrameRequestCallback[];
    let originalRaf: typeof globalThis.requestAnimationFrame;
    let originalCaf: typeof globalThis.cancelAnimationFrame;

    beforeEach(() => {
        rafCallbacks = [];
        originalRaf = globalThis.requestAnimationFrame;
        originalCaf = globalThis.cancelAnimationFrame;
        globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        globalThis.cancelAnimationFrame = vi.fn();
        // Provide a no-op ResizeObserver for jsdom
        globalThis.ResizeObserver = vi.fn().mockImplementation(function () { return ({
            observe: vi.fn(),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
        }); });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCaf;
    });

    function flushRaf() {
        const cbs = rafCallbacks.splice(0);
        cbs.forEach(cb => cb(performance.now()));
    }

    describe('visibility', () => {
        it('renders nothing when diffLines is empty', () => {
            renderMiniMap({ diffLines: [] });
            expect(screen.queryByTestId('diff-minimap')).toBeNull();
        });

        it('renders nothing when there are no changes (only context)', () => {
            renderMiniMap({ diffLines: makeLines(['context', 'context', 'context']) });
            expect(screen.queryByTestId('diff-minimap')).toBeNull();
        });

        it('renders nothing when there are only meta lines', () => {
            renderMiniMap({ diffLines: makeLines(['meta', 'meta', 'hunk-header']) });
            expect(screen.queryByTestId('diff-minimap')).toBeNull();
        });

        it('renders when there are added lines', () => {
            renderMiniMap({ diffLines: makeLines(['context', 'added', 'context']) });
            expect(screen.getByTestId('diff-minimap')).toBeTruthy();
        });

        it('renders when there are removed lines', () => {
            renderMiniMap({ diffLines: makeLines(['context', 'removed', 'context']) });
            expect(screen.getByTestId('diff-minimap')).toBeTruthy();
        });
    });

    describe('segment rendering', () => {
        it('renders correct number of segments', () => {
            const { container } = renderMiniMap();
            const segments = container.querySelectorAll('[data-testid^="diff-minimap-segment-"]');
            // meta(4) + hunk-header(1) + removed(2) + added(3) + context(2) = 5 segments
            expect(segments.length).toBe(5);
        });

        it('segments have correct data-segment-type attributes', () => {
            const { container } = renderMiniMap();
            const segments = container.querySelectorAll('[data-testid^="diff-minimap-segment-"]');
            const types = Array.from(segments).map(s => s.getAttribute('data-segment-type'));
            expect(types).toEqual(['meta', 'hunk-header', 'removed', 'added', 'context']);
        });

        it('added segments have green background via CSS variable', () => {
            renderMiniMap({ diffLines: makeLines(['added', 'added']) });
            const seg = screen.getByTestId('diff-minimap-segment-0');
            expect(seg.style.backgroundColor).toBe('var(--diff-minimap-added)');
        });

        it('removed segments have red background via CSS variable', () => {
            renderMiniMap({ diffLines: makeLines(['removed']) });
            const seg = screen.getByTestId('diff-minimap-segment-0');
            expect(seg.style.backgroundColor).toBe('var(--diff-minimap-removed)');
        });

        it('context segments have transparent background', () => {
            renderMiniMap({ diffLines: makeLines(['context', 'added']) });
            const seg = screen.getByTestId('diff-minimap-segment-0');
            expect(seg.style.backgroundColor).toBe('transparent');
        });

        it('segments use absolute positioning with top/height percentages', () => {
            const scrollContainer = createScrollContainer({
                lineHeights: [20, 20, 20],
            });
            renderMiniMap({
                diffLines: makeLines(['context', 'added', 'context']),
                scrollContainer,
            });

            act(() => flushRaf());

            const seg = screen.getByTestId('diff-minimap-segment-1');
            // The 'added' segment (at index 1 of 3 equal-height lines)
            // should have top ≈ 33.33%
            expect(parseFloat(seg.style.top)).toBeCloseTo(33.33, 0);
            expect(parseFloat(seg.style.height)).toBeCloseTo(33.33, 0);
        });
    });

    describe('pixel-based alignment with wrapped lines', () => {
        it('positions segments correctly when a line wraps to multiple visual rows', () => {
            // 5 lines: context(20px), removed(20px), added(60px wrapped), context(20px), context(20px)
            const scrollContainer = createScrollContainer({
                lineHeights: [20, 20, 60, 20, 20],
            });
            const diffLines = makeLines(['context', 'removed', 'added', 'context', 'context']);

            renderMiniMap({ diffLines, scrollContainer });
            act(() => flushRaf());

            // Segments: context(1), removed(1), added(1), context(2)
            // Total height = 140px
            const removedSeg = screen.getByTestId('diff-minimap-segment-1');
            const addedSeg = screen.getByTestId('diff-minimap-segment-2');

            // removed: top=20/140*100≈14.29%, height=20/140*100≈14.29%
            const removedTop = parseFloat(removedSeg.style.top);
            expect(removedTop).toBeCloseTo(14.29, 1);

            // added (wrapped): top=40/140*100≈28.57%
            const addedTop = parseFloat(addedSeg.style.top);
            expect(addedTop).toBeCloseTo(28.57, 1);

            // height should reflect the wrapped pixel height (60px / 140px ≈ 42.86%)
            const addedHeight = parseFloat(addedSeg.style.height);
            expect(addedHeight).toBeCloseTo(42.86, 1);
        });

        it('uniform-height lines produce evenly spaced segments', () => {
            const scrollContainer = createScrollContainer({
                lineHeights: [20, 20, 20, 20],
            });
            const diffLines = makeLines(['context', 'added', 'added', 'context']);

            renderMiniMap({ diffLines, scrollContainer });
            act(() => flushRaf());

            const contextSeg0 = screen.getByTestId('diff-minimap-segment-0');
            const addedSeg = screen.getByTestId('diff-minimap-segment-1');
            const contextSeg1 = screen.getByTestId('diff-minimap-segment-2');

            // Each line is 25% of total height
            expect(parseFloat(contextSeg0.style.top)).toBeCloseTo(0, 1);
            expect(parseFloat(addedSeg.style.top)).toBeCloseTo(25, 1);
            expect(parseFloat(contextSeg1.style.top)).toBeCloseTo(75, 1);
        });
    });

    describe('width', () => {
        it('applies correct width style', () => {
            renderMiniMap();
            const minimap = screen.getByTestId('diff-minimap');
            expect(minimap.style.width).toBe(`${MINIMAP_WIDTH}px`);
        });
    });

    describe('viewport indicator', () => {
        it('renders viewport indicator', () => {
            renderMiniMap();
            expect(screen.getByTestId('diff-minimap-viewport')).toBeTruthy();
        });

        it('viewport indicator has the correct CSS class', () => {
            renderMiniMap();
            const viewport = screen.getByTestId('diff-minimap-viewport');
            expect(viewport.className).toContain('diff-minimap-viewport');
        });
    });

    describe('click navigation', () => {
        it('scrolls the container when strip area is clicked', () => {
            const scrollContainer = createScrollContainer();
            renderMiniMap({ scrollContainer });

            const stripArea = screen.getByTestId('diff-minimap-strip-area');

            // Mock getBoundingClientRect for the strip area
            vi.spyOn(stripArea, 'getBoundingClientRect').mockReturnValue({
                top: 0, left: 0, width: 14, height: 200,
                bottom: 200, right: 14, x: 0, y: 0, toJSON: () => {},
            });

            fireEvent.click(stripArea, { clientX: 7, clientY: 100 });

            // Should have called scrollTo (ratio = 100/200 = 0.5)
            expect(scrollContainer.scrollTo).toHaveBeenCalled();
        });
    });

    describe('drag behavior', () => {
        it('starts drag on viewport mousedown', () => {
            const scrollContainer = createScrollContainer();
            renderMiniMap({ scrollContainer });

            const viewport = screen.getByTestId('diff-minimap-viewport');

            // Should not throw
            fireEvent.mouseDown(viewport);

            // Simulate mouse move and mouse up on document
            fireEvent.mouseMove(document, { clientX: 7, clientY: 50 });
            fireEvent.mouseUp(document);
        });
    });

    describe('edge cases', () => {
        it('handles single added line', () => {
            renderMiniMap({ diffLines: makeLines(['added']) });
            expect(screen.getByTestId('diff-minimap')).toBeTruthy();
            expect(screen.getByTestId('diff-minimap-segment-0')).toBeTruthy();
        });

        it('handles large diff with many segments', () => {
            const types: DiffLine['type'][] = [];
            for (let i = 0; i < 100; i++) {
                types.push('context', 'context', 'added', 'removed', 'context');
            }
            renderMiniMap({ diffLines: makeLines(types) });
            expect(screen.getByTestId('diff-minimap')).toBeTruthy();
        });

        it('handles all-added diff', () => {
            renderMiniMap({ diffLines: makeLines(Array(20).fill('added')) });
            expect(screen.getByTestId('diff-minimap')).toBeTruthy();
            const segments = screen.getByTestId('diff-minimap-strip-area').children;
            // Viewport + 1 segment
            expect(segments.length).toBe(2);
        });

        it('handles all-removed diff', () => {
            renderMiniMap({ diffLines: makeLines(Array(15).fill('removed')) });
            expect(screen.getByTestId('diff-minimap')).toBeTruthy();
        });

        it('handles scroll container with zero scroll height', () => {
            const scrollContainer = createScrollContainer();
            Object.defineProperty(scrollContainer, 'scrollHeight', { value: 0, configurable: true });
            Object.defineProperty(scrollContainer, 'clientHeight', { value: 0, configurable: true });
            // Should not throw
            renderMiniMap({ scrollContainer });
            expect(screen.getByTestId('diff-minimap')).toBeTruthy();
        });

        it('handles no line-index elements gracefully (fallback)', () => {
            // A container with no data-diff-line-index children
            const scrollContainer = createScrollContainer();
            renderMiniMap({ scrollContainer });
            // Should render without errors
            expect(screen.getByTestId('diff-minimap')).toBeTruthy();
        });
    });
});
