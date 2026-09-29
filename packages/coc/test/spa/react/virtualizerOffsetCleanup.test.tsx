/** Regression cover for virtualizer cleanup and the diff viewers' observer choice. */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { observeElementOffset, type Virtualizer } from '@tanstack/react-virtual';

const { observeSpy } = vi.hoisted(() => ({ observeSpy: vi.fn() }));

vi.mock('@tanstack/react-virtual', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tanstack/react-virtual')>();
    return {
        ...actual,
        useVirtualizer: (...args: Parameters<typeof actual.useVirtualizer>) => {
            observeSpy(args[0].observeElementOffset);
            return actual.useVirtualizer(...args);
        },
    };
});

import { UnifiedDiffViewer, VIRTUALIZE_THRESHOLD } from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import { SideBySideDiffViewer } from '../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer';

type OffsetCall = { offset: number; isScrolling: boolean };

/**
 * The slice of a Virtualizer that `observeElementOffset` actually reads.
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

describe('virtualizer offset cleanup', () => {
    it('forwards offsets while it is live', () => {
        vi.useFakeTimers();
        const el = document.createElement('div');
        const seen: OffsetCall[] = [];
        const stop = observeElementOffset(fakeVirtualizer(el), (offset, isScrolling) =>
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

    it('cancels the scroll-stop timer on cleanup', () => {
        vi.useFakeTimers();
        const el = document.createElement('div');
        const seen: OffsetCall[] = [];
        const stop = observeElementOffset(fakeVirtualizer(el), (offset, isScrolling) =>
            seen.push({ offset, isScrolling })
        );

        el.dispatchEvent(new Event('scroll'));
        stop();
        seen.length = 0;

        vi.advanceTimersByTime(500);
        expect(seen).toEqual([]);
    });

    it('removes the scroll listener on cleanup', () => {
        vi.useFakeTimers();
        const el = document.createElement('div');
        const seen: OffsetCall[] = [];
        const stop = observeElementOffset(fakeVirtualizer(el), (offset, isScrolling) =>
            seen.push({ offset, isScrolling })
        );

        stop?.();
        el.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(500);
        expect(seen).toEqual([]);
    });
});

describe('windowed diff viewers use native offset cleanup', () => {
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
    ])('%s mode uses the virtualizer default offset observer', (_name, Viewer) => {
        withMeasuredElements(() => {
            render(
                <div data-testid="scroller" style={{ overflowY: 'scroll', height: 600 }}>
                    <Viewer diff={DIFF} showFileBanners data-testid="diff" />
                </div>
            );
        });

        expect(observeSpy).toHaveBeenCalledWith(undefined);
    });
});
