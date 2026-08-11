/**
 * File-name banner under windowing (diffs over VIRTUALIZE_THRESHOLD lines).
 *
 * Windowed rows are absolutely positioned, so the in-flow sticky banner cannot
 * hold. Both viewers instead overlay a copy of the current file's banner — but
 * only once that file's own in-flow banner row has scrolled above the top edge,
 * so the top edge always carries exactly one banner and never two for the same
 * file. The virtualization block mocks offsetHeight/offsetWidth (what
 * @tanstack/react-virtual measures), matching UnifiedDiffViewer.find.test.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { UnifiedDiffViewer, VIRTUALIZE_THRESHOLD } from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import { SideBySideDiffViewer } from '../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer';

/** A two-file diff whose first file is long enough to force windowing. */
function largeTwoFileDiff(bodyLines: number): string {
    const body = Array.from({ length: bodyLines }, (_, i) => ` context ${i}`);
    return [
        'diff --git a/src/big.ts b/src/big.ts',
        'index 2793a9ad6..8cd4f108a 100644',
        '--- a/src/big.ts',
        '+++ b/src/big.ts',
        `@@ -1,${bodyLines} +1,${bodyLines} @@`,
        ...body,
        '-old tail',
        '+new tail',
        'diff --git a/src/second.ts b/src/second.ts',
        'new file mode 100644',
        'index 0000000..e69de29',
        '--- /dev/null',
        '+++ b/src/second.ts',
        '@@ -0,0 +1,1 @@',
        '+second file line',
    ].join('\n');
}

/**
 * Drive the scroll element the virtualizer subscribes to. Both viewers resolve
 * it via getScrollableAncestor, which lands on the `scroller` wrapper below.
 */
function scrollWindowedList(container: HTMLElement, top: number) {
    const scroller = container.querySelector<HTMLElement>('[data-testid="scroller"]')!;
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event('scroll'));
}

const VIEWERS = [
    { name: 'unified', Viewer: UnifiedDiffViewer },
    { name: 'split', Viewer: SideBySideDiffViewer },
] as const;

describe.each(VIEWERS)('file-name banner under windowing — $name mode', ({ Viewer }) => {
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

    function renderWindowed(ui: React.ReactElement) {
        return render(
            <div data-testid="scroller" style={{ overflowY: 'scroll', height: 600 }}>
                {ui}
            </div>
        );
    }

    const DIFF = largeTwoFileDiff(VIRTUALIZE_THRESHOLD + 50);

    it('shows exactly one banner for the first file at scroll top — the in-flow row, no overlay', () => {
        const { container } = renderWindowed(
            <Viewer diff={DIFF} showFileBanners data-testid="diff" />
        );
        // The regression: an overlay was rendered unconditionally, so at scroll 0
        // it duplicated the first file's own in-flow banner row.
        const forBigTs = container.querySelectorAll(
            '[data-testid^="diff-file-banner"][data-file-path="src/big.ts"]'
        );
        expect(forBigTs.length).toBe(1);
        expect(container.querySelector('[data-testid="diff-file-banner-pinned"]')).toBeNull();
        const inFlow = forBigTs[0] as HTMLElement;
        expect(inFlow.getAttribute('data-testid')).toBe('diff-file-banner');
        expect(inFlow.querySelector('[data-testid="diff-file-banner-status"]')!.textContent).toBe('modified');
    });

    it('overlays the current file once its banner row is above the fold', () => {
        const { container } = renderWindowed(
            <Viewer diff={DIFF} showFileBanners data-testid="diff" />
        );
        act(() => { scrollWindowedList(container, 24000); });

        const pinned = container.querySelector<HTMLElement>('[data-testid="diff-file-banner-pinned"]');
        expect(pinned).toBeTruthy();
        expect(pinned!.getAttribute('data-file-path')).toBe('src/big.ts');
        // Still exactly one banner for the file: its in-flow row is off-screen.
        expect(
            container.querySelectorAll('[data-testid^="diff-file-banner"][data-file-path="src/big.ts"]').length
        ).toBe(1);
    });

    it('wraps the overlay in a zero-height sticky container so it never shifts the rows', () => {
        const { container } = renderWindowed(
            <Viewer diff={DIFF} showFileBanners data-testid="diff" />
        );
        act(() => { scrollWindowedList(container, 24000); });

        const pinned = container.querySelector<HTMLElement>('[data-testid="diff-file-banner-pinned"]')!;
        // The row itself is not sticky — its wrapper is, since windowed rows are
        // absolutely positioned and cannot participate in sticky flow.
        expect(pinned.className).not.toContain('sticky');
        const inner = pinned.parentElement!;
        expect(inner.className).toContain('absolute');
        const wrapper = inner.parentElement!;
        expect(wrapper.className).toContain('sticky');
        expect(wrapper.className).toContain('top-0');
        // Zero-height: the overlay is out of flow, so mounting it cannot push
        // the virtualized row list down.
        expect(wrapper.className).toContain('h-0');
    });

    it('still suppresses the raw preamble in the mounted rows', () => {
        const { container } = renderWindowed(
            <Viewer diff={DIFF} showFileBanners data-testid="diff" />
        );
        expect(container.textContent).not.toContain('diff --git');
        expect(container.textContent).not.toContain('index 2793a9ad6..8cd4f108a');
        expect(container.textContent).not.toContain('--- a/src/big.ts');
    });

    it('pins nothing when banners are off', () => {
        const { container } = renderWindowed(<Viewer diff={DIFF} data-testid="diff" />);
        expect(container.querySelector('[data-testid="diff-file-banner-pinned"]')).toBeNull();
        expect(container.querySelector('[data-testid="diff-file-banner"]')).toBeNull();
    });
});
