/**
 * UnifiedDiffViewer — windowed rows that render nothing must occupy no space.
 *
 * Regression: on the virtualized path every row index gets a wrapper element,
 * and the virtualizer sized all of them at DIFF_LINE_ESTIMATE_PX. Rows that
 * `renderLineRow` drops (git preamble hidden by `hideFileHeaders`, preamble
 * suppressed behind a file banner, and lines inside a collapsed hunk) therefore
 * reserved a blank band — a large diff opened with ~4 empty rows above its first
 * `@@` header, and collapsing a hunk left a hole the size of the hunk.
 *
 * Row heights here come from the estimate: jsdom reports 0-height rects, and
 * only rows that rendered content fall back to the estimate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import {
    UnifiedDiffViewer,
    DIFF_LINE_ESTIMATE_PX,
    VIRTUALIZE_THRESHOLD,
} from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import type { HunkClassification } from '../../../src/server/spa/client/react/features/pull-requests/classification-types';

/** Preamble rows every diff below starts with (indices 0-3). */
const PREAMBLE_ROWS = 4;

/** A one-hunk diff over VIRTUALIZE_THRESHOLD, so the windowed path is taken. */
function makeDiff(n: number): string {
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

/** translateY(px) of the windowed wrapper for a given row index. */
function offsetOfRow(container: HTMLElement, index: number): number {
    const el = container.querySelector(`[data-index="${index}"]`) as HTMLElement | null;
    if (!el) throw new Error(`row ${index} is not mounted`);
    const m = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform);
    if (!m) throw new Error(`row ${index} has no translateY: ${el.style.transform}`);
    return Number(m[1]);
}

/** Total scroll height the virtualizer reserves for the whole row list. */
function totalSize(container: HTMLElement): number {
    const spacer = container.querySelector('[data-index]')?.parentElement as HTMLElement;
    return Number.parseFloat(spacer.style.height);
}

beforeEach(() => {
    // The virtualizer reads offsetWidth/offsetHeight for the scroll element's
    // rect; jsdom reports 0 for every layout metric otherwise.
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 });
});

afterEach(() => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    delete proto.clientHeight;
    delete proto.offsetHeight;
    delete proto.offsetWidth;
    vi.restoreAllMocks();
});

describe('windowed rows that render nothing reserve no height', () => {
    it('opens a hideFileHeaders diff with the first hunk header flush at the top', () => {
        const rows = VIRTUALIZE_THRESHOLD + 100;
        const { container } = renderWindowed(
            <UnifiedDiffViewer diff={makeDiff(rows)} fileName="big.ts" hideFileHeaders data-testid="diff" />
        );

        // Rows 0-3 are the dropped preamble; row 4 is the `@@` header.
        for (let i = 0; i < PREAMBLE_ROWS; i++) expect(offsetOfRow(container, i)).toBe(0);
        expect(offsetOfRow(container, PREAMBLE_ROWS)).toBe(0);
        expect(offsetOfRow(container, PREAMBLE_ROWS + 1)).toBe(DIFF_LINE_ESTIMATE_PX);
        // Nothing is reserved for the four dropped rows.
        expect(totalSize(container)).toBe((rows + 1) * DIFF_LINE_ESTIMATE_PX);
    });

    it('keeps the preamble spacing when file headers are shown (no over-collapsing)', () => {
        const rows = VIRTUALIZE_THRESHOLD + 100;
        const { container } = renderWindowed(
            <UnifiedDiffViewer diff={makeDiff(rows)} fileName="big.ts" data-testid="diff" />
        );

        expect(offsetOfRow(container, PREAMBLE_ROWS)).toBe(PREAMBLE_ROWS * DIFF_LINE_ESTIMATE_PX);
        expect(totalSize(container)).toBe((rows + PREAMBLE_ROWS + 1) * DIFF_LINE_ESTIMATE_PX);
    });

    it('reserves one row for the banner and none for the preamble it replaces', () => {
        const rows = VIRTUALIZE_THRESHOLD + 100;
        const { container } = renderWindowed(
            <UnifiedDiffViewer diff={makeDiff(rows)} fileName="big.ts" showFileBanners data-testid="diff" />
        );

        // Row 0 renders the banner; rows 1-3 are suppressed, so the `@@` header
        // sits directly under the banner.
        expect(offsetOfRow(container, 0)).toBe(0);
        expect(offsetOfRow(container, PREAMBLE_ROWS)).toBe(DIFF_LINE_ESTIMATE_PX);
        expect(totalSize(container)).toBe((rows + 2) * DIFF_LINE_ESTIMATE_PX);
    });
});

describe('collapsed hunks reserve no height for their skipped lines', () => {
    const BODY = 40;
    const TAIL = VIRTUALIZE_THRESHOLD + 50;

    /** Two hunks: a small `logic` one, then a long `generated` one. */
    function twoHunkDiff(): string {
        const lines = [
            'diff --git a/foo.ts b/foo.ts',
            'index 1111111..2222222 100644',
            '--- a/foo.ts',
            '+++ b/foo.ts',
            `@@ -1,${BODY} +1,${BODY} @@`,
        ];
        for (let i = 0; i < BODY; i++) lines.push(` const ctx${i} = ${i};`);
        lines.push(`@@ -100,${TAIL} +100,${TAIL} @@`);
        for (let i = 0; i < TAIL; i++) lines.push(`+generated ${i}`);
        return lines.join('\n');
    }

    const HUNKS: HunkClassification[] = [
        { file: 'foo.ts', hunkIndex: 0, category: 'logic', intensity: 'high', reason: 'core logic' },
        { file: 'foo.ts', hunkIndex: 1, category: 'generated', intensity: 'low', reason: 'generated' },
    ];

    it('shrinks the scroll height by the collapsed hunk body', () => {
        const diff = twoHunkDiff();
        const totalRows = diff.split('\n').length;
        const props = {
            diff,
            fileName: 'foo.ts',
            filePath: 'foo.ts',
            getHunkClassification: (file: string, hunkIndex: number) =>
                HUNKS.find(h => h.file === file && h.hunkIndex === hunkIndex) ?? null,
            'data-testid': 'diff',
        };

        const { container, rerender, scroller } = renderWindowed(
            <UnifiedDiffViewer {...props} activeFilters={new Set(['logic', 'generated'] as const)} />
        );
        expect(totalSize(container)).toBe(totalRows * DIFF_LINE_ESTIMATE_PX);

        act(() => {
            rerender(
                <div data-testid="scroller" style={{ overflowY: 'scroll', height: 600 }}>
                    <UnifiedDiffViewer {...props} activeFilters={new Set(['logic'] as const)} />
                </div>
            );
        });
        void scroller;

        // The generated hunk's body collapses into its summary row: every line
        // after its `@@` header stops reserving space.
        expect(totalSize(container)).toBe((totalRows - TAIL) * DIFF_LINE_ESTIMATE_PX);
    });
});
