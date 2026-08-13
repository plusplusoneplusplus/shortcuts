/**
 * Regression cover for the leaked virtualizer scroll-stop timer.
 *
 * virtual-core's `observeElementOffset` debounces a trailing "scrolling has
 * stopped" callback on every scroll event and its cleanup removes only the
 * scroll listeners, so the pending timer outlives unmount and re-renders a
 * component that is already gone. Under jsdom that killed whole shards: a timer
 * scheduled by the last scroll of one test file fired while the *next* file was
 * running, after the first file's `window` had been torn down, and React blew up
 * with `ReferenceError: window is not defined` reading event priority. Vitest
 * counts that as an unhandled error and fails the run.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { observeElementOffset, type Virtualizer } from '@tanstack/react-virtual';

const { observeSpy } = vi.hoisted(() => ({ observeSpy: vi.fn() }));

// Delegates to the real implementation — the spy only records that the viewers
// still route their offset observation through it.
vi.mock('../../../src/server/spa/client/react/features/git/diff/observeOffsetUntilCleanup', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/server/spa/client/react/features/git/diff/observeOffsetUntilCleanup')>();
    return {
        ...actual,
        observeOffsetUntilCleanup: (...args: Parameters<typeof actual.observeOffsetUntilCleanup>) => {
            observeSpy();
            return actual.observeOffsetUntilCleanup(...args);
        },
    };
});

import { observeOffsetUntilCleanup } from '../../../src/server/spa/client/react/features/git/diff/observeOffsetUntilCleanup';
import { UnifiedDiffViewer, VIRTUALIZE_THRESHOLD } from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import { SideBySideDiffViewer } from '../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer';

type OffsetCall = { offset: number; isScrolling: boolean };

/**
 * The slice of a Virtualizer that `observeElementOffset` actually reads. Using
 * the real library observer (rather than a stub) is the point — the leak being
 * guarded against lives inside it.
 */
function fakeVirtualizer(scrollElement: HTMLElement) {
    return {
        scrollElement,
        targetWindow: window,
        options: {
            // Force the debounced fallback path rather than native `scrollend`.
            useScrollendEvent: false,
            isScrollingResetDelay: 150,
            horizontal: false,
            isRtl: false,
        },
    } as unknown as Virtualizer<HTMLElement, HTMLElement>;
}

afterEach(() => {
    vi.useRealTimers();
    observeSpy.mockClear();
});

describe('observeOffsetUntilCleanup', () => {
    it('forwards offsets while it is live', () => {
        vi.useFakeTimers();
        const el = document.createElement('div');
        const seen: OffsetCall[] = [];
        const stop = observeOffsetUntilCleanup(fakeVirtualizer(el), (offset, isScrolling) =>
            seen.push({ offset, isScrolling })
        );

        el.dispatchEvent(new Event('scroll'));
        expect(seen).toEqual([{ offset: 0, isScrolling: true }]);

        // The trailing scroll-stop callback still lands before cleanup.
        vi.advanceTimersByTime(200);
        expect(seen).toEqual([
            { offset: 0, isScrolling: true },
            { offset: 0, isScrolling: false },
        ]);

        stop();
    });

    it('swallows the scroll-stop timer that lands after cleanup', () => {
        vi.useFakeTimers();
        const el = document.createElement('div');
        const seen: OffsetCall[] = [];
        const stop = observeOffsetUntilCleanup(fakeVirtualizer(el), (offset, isScrolling) =>
            seen.push({ offset, isScrolling })
        );

        el.dispatchEvent(new Event('scroll'));
        stop();
        seen.length = 0;

        // This is the timer that used to reach React after teardown.
        vi.advanceTimersByTime(500);
        expect(seen).toEqual([]);
    });

    it('canary: the stock observer still leaks, so the wrapper is still needed', () => {
        vi.useFakeTimers();
        const el = document.createElement('div');
        const seen: OffsetCall[] = [];
        const stop = observeElementOffset(fakeVirtualizer(el), (offset, isScrolling) =>
            seen.push({ offset, isScrolling })
        );

        el.dispatchEvent(new Event('scroll'));
        stop?.();
        seen.length = 0;
        vi.advanceTimersByTime(500);

        // If this ever comes back empty, @tanstack/react-virtual has started
        // clearing its debounce on cleanup and observeOffsetUntilCleanup can go.
        expect(seen).toEqual([{ offset: 0, isScrolling: false }]);
    });
});

describe('windowed diff viewers observe offsets through the wrapper', () => {
    const DIFF = [
        'diff --git a/src/big.ts b/src/big.ts',
        'index 2793a9ad6..8cd4f108a 100644',
        '--- a/src/big.ts',
        '+++ b/src/big.ts',
        `@@ -1,${VIRTUALIZE_THRESHOLD + 50} +1,${VIRTUALIZE_THRESHOLD + 50} @@`,
        ...Array.from({ length: VIRTUALIZE_THRESHOLD + 50 }, (_, i) => ` context ${i}`),
    ].join('\n');

    // @tanstack/react-virtual measures offsetHeight/offsetWidth, which jsdom
    // reports as 0 — without these the list never windows.
    function withMeasuredElements(run: () => void) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 });
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 });
        try {
            run();
        } finally {
            const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
            delete proto.clientHeight;
            delete proto.offsetHeight;
            delete proto.offsetWidth;
        }
    }

    it.each([
        ['unified', UnifiedDiffViewer],
        ['split', SideBySideDiffViewer],
    ])('%s mode passes observeOffsetUntilCleanup to its virtualizer', (_name, Viewer) => {
        withMeasuredElements(() => {
            render(
                <div data-testid="scroller" style={{ overflowY: 'scroll', height: 600 }}>
                    <Viewer diff={DIFF} showFileBanners data-testid="diff" />
                </div>
            );
        });

        expect(observeSpy).toHaveBeenCalled();
    });
});
