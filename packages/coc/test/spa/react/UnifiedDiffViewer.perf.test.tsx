/**
 * UnifiedDiffViewer — performance regression gates.
 *
 * jsdom does no real layout and CPU timing under `pool: 'forks'` is noisy, so
 * wall-clock ms is not a reliable CI gate. These hard gates instead assert the
 * two *structural* invariants that encode the large-file rendering improvements:
 *
 *   Gate 1 — windowing bounds the mounted DOM-node count.
 *   Gate 2 — syntax highlighting is computed once, never per-render.
 *   Gate 3 — imperative navigation works when rows are off-screen.
 *   Gate 4 — generated/lock files skip highlight + word-level intra-line diff.
 *
 * A wall-clock micro-benchmark is kept as an informational, generously-bounded
 * sanity check (catches only catastrophic regressions).
 *
 * The size mocks mirror the pattern in DiffMiniMap.test.tsx (mocked
 * getBoundingClientRect + clientHeight) and rely on the no-op ResizeObserver
 * stub from test/setup.ts.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { createRef, Profiler } from 'react';
import hljs from 'highlight.js/lib/core';
import {
    UnifiedDiffViewer,
    computeDiffLines,
    computeEditStarts,
    type UnifiedDiffViewerHandle,
} from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';

// ── Helpers ────────────────────────────────────────────────────────────

/** Build a synthetic unified diff with `n` changed lines in one hunk. */
function makeLargeDiff(n: number): string {
    const lines: string[] = [
        'diff --git a/big.ts b/big.ts',
        'index 1111111..2222222 100644',
        '--- a/big.ts',
        '+++ b/big.ts',
        `@@ -1,${n} +1,${n} @@`,
    ];
    for (let i = 0; i < n; i++) {
        const mod = i % 3;
        if (mod === 0) lines.push(`-const oldValue${i} = ${i};`);
        else if (mod === 1) lines.push(`+const newValue${i} = ${i};`);
        else lines.push(` const contextValue${i} = ${i};`);
    }
    return lines.join('\n');
}

/** Build a large JSON lock-file-shaped diff (paired -/+ lines → would word-diff). */
function makeJsonDiff(n: number): string {
    const lines: string[] = [
        'diff --git a/package-lock.json b/package-lock.json',
        'index 1111111..2222222 100644',
        '--- a/package-lock.json',
        '+++ b/package-lock.json',
        `@@ -1,${n} +1,${n} @@`,
    ];
    for (let i = 0; i < n; i++) {
        lines.push(`-      "version": "1.0.${i}",`);
        lines.push(`+      "version": "1.0.${i + 1}",`);
    }
    return lines.join('\n');
}

/**
 * Render `ui` inside a scrollable ancestor with a mocked 600px viewport.
 * getBoundingClientRect + clientHeight are patched on the prototype so the
 * dimensions are available while the virtualizer's layout effect runs (which
 * happens synchronously inside render()'s act() wrapper).
 */
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

// ── Prototype size mocks ────────────────────────────────────────────────

let rectSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
    // Give every element a non-zero viewport so the virtualizer measures a real
    // window (jsdom reports 0 for layout metrics by default). @tanstack/react-
    // virtual reads offsetWidth/offsetHeight for the scroll element's rect, so
    // those must be mocked (not just getBoundingClientRect).
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

// ── Gate 1 — windowing bounds the DOM ───────────────────────────────────

describe('Gate 1 — windowing bounds the mounted row count', () => {
    it('mounts only viewport+overscan rows for a 20,000-line diff', () => {
        const total = 20000;
        const { container } = renderWindowed(
            <UnifiedDiffViewer diff={makeLargeDiff(total)} fileName="big.ts" data-testid="diff" />
        );
        const mounted = container.querySelectorAll('[data-diff-line-index]').length;
        // Pre-change this mounts ~20k rows; post-change only the viewport window.
        expect(mounted).toBeGreaterThan(0);
        expect(mounted).toBeLessThan(200);
        expect(mounted).toBeLessThan(total / 10);
    });

    it('renders every row for a small diff (eager path unchanged)', () => {
        const diff = makeLargeDiff(30);
        const { container } = renderWindowed(
            <UnifiedDiffViewer diff={diff} fileName="big.ts" data-testid="diff" />
        );
        // Below the threshold every line (5 header + 30 content) is mounted.
        const mounted = container.querySelectorAll('[data-diff-line-index]').length;
        expect(mounted).toBe(diff.split('\n').length);
    });
});

// ── Gate 2 — highlighting computed once, never per-render ────────────────

describe('Gate 2 — syntax highlighting is computed once', () => {
    it('does not re-run highlight.js on a state-only re-render', () => {
        const spy = vi.spyOn(hljs, 'highlight');
        const diff = makeLargeDiff(2000);

        const { rerender } = renderWindowed(
            <UnifiedDiffViewer diff={diff} fileName="big.ts" data-testid="diff" showLineNumbers={false} />
        );
        const c1 = spy.mock.calls.length;
        // One block pass per contiguous same-language run — a handful, NOT one per line.
        expect(c1).toBeGreaterThan(0);
        expect(c1).toBeLessThan(50);

        // Re-render with a content-independent prop change (same diff string).
        rerender(
            <div data-testid="scroller" style={{ overflowY: 'scroll', height: 600 }}>
                <UnifiedDiffViewer diff={diff} fileName="big.ts" data-testid="diff" showLineNumbers={true} />
            </div>
        );
        // No new highlight.js calls — highlighting left the render path.
        expect(spy.mock.calls.length).toBe(c1);
    });
});

// ── Gate 3 — imperative navigation works with off-screen rows ────────────

describe('Gate 3 — imperative navigation under virtualization', () => {
    it('getHunkCount is derived from diffLines, not mounted DOM', () => {
        const total = 20000;
        const diff = makeLargeDiff(total);
        const ref = createRef<UnifiedDiffViewerHandle>();
        renderWindowed(<UnifiedDiffViewer ref={ref} diff={diff} fileName="big.ts" data-testid="diff" />);

        const expected = computeEditStarts(computeDiffLines(diff.split('\n'))).size;
        expect(expected).toBeGreaterThan(1000); // most rows are off-screen
        expect(ref.current?.getHunkCount()).toBe(expected);
    });

    it('advances the cursor and scrolls toward an off-screen hunk', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { scroller } = renderWindowed(
            <UnifiedDiffViewer ref={ref} diff={makeLargeDiff(20000)} fileName="big.ts" data-testid="diff" />
        );

        expect(ref.current?.getCurrentHunkIndex()).toBe(-1);
        act(() => ref.current?.scrollToNextHunk());
        expect(ref.current?.getCurrentHunkIndex()).toBe(0);

        act(() => ref.current?.scrollToHunk(500));
        expect(ref.current?.getCurrentHunkIndex()).toBe(500);

        // The virtualizer drove a scroll on the discovered scroll ancestor.
        expect(scroller.scrollTo).toHaveBeenCalled();
    });

    it('scrollToPrevHunk wraps to the last hunk when called first', () => {
        const diff = makeLargeDiff(20000);
        const ref = createRef<UnifiedDiffViewerHandle>();
        renderWindowed(<UnifiedDiffViewer ref={ref} diff={diff} fileName="big.ts" data-testid="diff" />);

        const count = computeEditStarts(computeDiffLines(diff.split('\n'))).size;
        act(() => ref.current?.scrollToPrevHunk());
        expect(ref.current?.getCurrentHunkIndex()).toBe(count - 1);
    });
});

// ── Gate 4 — generated-file fast path ───────────────────────────────────

describe('Gate 4 — generated/lock file fast path', () => {
    it('skips highlight.js and produces no intra-line <mark> spans', () => {
        const spy = vi.spyOn(hljs, 'highlight');
        const { container } = renderWindowed(
            <UnifiedDiffViewer diff={makeJsonDiff(40)} fileName="package-lock.json" data-testid="diff" />
        );

        // No syntax highlighting on the fast path.
        expect(spy).not.toHaveBeenCalled();
        // No word-level intra-line diff highlighting either.
        expect(container.querySelectorAll('mark').length).toBe(0);
    });

    it('still highlights a normal file of the same size', () => {
        const spy = vi.spyOn(hljs, 'highlight');
        renderWindowed(
            <UnifiedDiffViewer diff={makeJsonDiff(40)} fileName="config.json" data-testid="diff" />
        );
        expect(spy).toHaveBeenCalled();
    });
});

// ── Informational — wall-clock micro-benchmark (soft ceiling) ───────────

describe('bench (soft) — first mount + re-render stay under a generous ceiling', () => {
    it('mounts a 20,000-line diff and re-renders quickly', () => {
        const diff = makeLargeDiff(20000);
        let firstMount = 0;
        let lastCommit = 0;
        const onRender = (
            _id: string,
            phase: 'mount' | 'update' | 'nested-update',
            actualDuration: number,
        ) => {
            if (phase === 'mount' && firstMount === 0) firstMount = actualDuration;
            lastCommit = actualDuration;
        };

        const { rerender } = renderWindowed(
            <Profiler id="diff" onRender={onRender}>
                <UnifiedDiffViewer diff={diff} fileName="big.ts" data-testid="diff" showLineNumbers={false} />
            </Profiler>
        );
        const mountMs = firstMount;

        rerender(
            <div data-testid="scroller" style={{ overflowY: 'scroll', height: 600 }}>
                <Profiler id="diff" onRender={onRender}>
                    <UnifiedDiffViewer diff={diff} fileName="big.ts" data-testid="diff" showLineNumbers={true} />
                </Profiler>
            </div>
        );
        const rerenderMs = lastCommit;

        // Generous ceilings — catch only catastrophic regressions, not CI jitter.
        // eslint-disable-next-line no-console
        console.log(`[bench] mount=${mountMs.toFixed(1)}ms rerender=${rerenderMs.toFixed(1)}ms`);
        expect(mountMs).toBeLessThan(750);
        expect(rerenderMs).toBeLessThan(200);
    });
});
