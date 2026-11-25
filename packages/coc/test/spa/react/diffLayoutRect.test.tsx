import { createRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnifiedDiffViewer, type UnifiedDiffViewerHandle } from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import { SideBySideDiffViewer } from '../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer';
import { diffLayoutRect } from '../../../src/server/spa/client/react/features/git/diff/diffLayoutRect';
import { measureLineOffsets } from '../../../src/server/spa/client/react/features/git/diff/DiffMiniMap';

const originalZoom = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'currentCSSZoom');
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalZoom) Object.defineProperty(HTMLElement.prototype, 'currentCSSZoom', originalZoom);
    else delete (HTMLElement.prototype as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom;
});

const diff = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new';
function setZoom(zoom: number) {
    Object.defineProperty(HTMLElement.prototype, 'currentCSSZoom', { configurable: true, value: zoom });
}
function rect(top: number, height: number): DOMRect {
    return { top, height, left: 0, width: 100, right: 100, bottom: top + height, x: 0, y: top, toJSON() {} };
}

describe('Git review layout coordinates under CSS zoom', () => {
    it.each([0.5, 1, 1.25, 2])('keeps row heights and minimap offsets in scroll units at %s zoom', zoom => {
        setZoom(zoom);
        const scroller = document.createElement('div');
        const row = document.createElement('div');
        row.dataset.diffLineIndex = '0';
        scroller.appendChild(row);
        scroller.scrollTop = 40;
        vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(100 * zoom, 300 * zoom));
        vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(500 * zoom, 24 * zoom));
        expect(diffLayoutRect(row).height).toBe(24);
        expect(measureLineOffsets(scroller).offsets[0]).toEqual({ top: 440, height: 24 });
    });

    it('retains layout measurements on hosts without currentCSSZoom', () => {
        const row = document.createElement('div');
        vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(100, 24));
        expect(diffLayoutRect(row)).toEqual({ top: 100, height: 24 });
    });

    for (const Viewer of [UnifiedDiffViewer, SideBySideDiffViewer]) {
        it.each([0.5, 1.25, 2])(`${Viewer.displayName ?? 'diff viewer'} navigates to the same hunk at %s zoom`, zoom => {
            setZoom(zoom);
            const ref = createRef<UnifiedDiffViewerHandle>();
            const { container } = render(<div data-testid="scroller" style={{ overflowY: 'auto' }}>
                <Viewer ref={ref} diff={diff} />
            </div>);
            const scroller = container.querySelector<HTMLElement>('[data-testid="scroller"]')!;
            Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 300 });
            scroller.scrollTop = 40;
            scroller.scrollTo = vi.fn();
            vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(100 * zoom, 300 * zoom));
            for (const row of container.querySelectorAll<HTMLElement>('[data-edit-start]')) {
                vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(500 * zoom, 24 * zoom));
            }
            act(() => ref.current!.scrollToNextHunk());
            expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 340, behavior: 'smooth' });
            act(() => ref.current!.scrollToPrevHunk());
            expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: 340, behavior: 'smooth' });
            act(() => ref.current!.scrollToHunk(0));
            expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: 340, behavior: 'smooth' });
        });
    }
});
