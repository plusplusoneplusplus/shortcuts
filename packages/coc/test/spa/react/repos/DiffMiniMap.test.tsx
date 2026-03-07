/**
 * DiffMiniMap — comprehensive tests.
 *
 * Covers segment building, rendering, click navigation, viewport indicator,
 * drag scrolling, visibility conditions, and edge cases.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
    DiffMiniMap,
    buildDiffSegments,
    getSegmentColor,
    MINIMAP_WIDTH,
    type DiffSegment,
} from '../../../../src/server/spa/client/react/repos/DiffMiniMap';
import type { DiffLine } from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';

// ── Helpers ────────────────────────────────────────────────────────────

function makeLine(type: DiffLine['type'], index: number): DiffLine {
    return { index, type, content: `${type} line ${index}` };
}

function makeLines(types: DiffLine['type'][]): DiffLine[] {
    return types.map((type, i) => makeLine(type, i));
}

function createScrollContainer(): HTMLDivElement {
    const el = document.createElement('div');
    Object.defineProperties(el, {
        scrollHeight: { value: 2000, configurable: true },
        clientHeight: { value: 500, configurable: true },
        scrollTop: { value: 0, writable: true, configurable: true },
    });
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

// ── Component rendering tests ──────────────────────────────────────────

describe('DiffMiniMap', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

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
    });
});
