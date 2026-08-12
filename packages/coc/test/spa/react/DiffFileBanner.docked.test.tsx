/**
 * File-name banner docked at the top edge on the eager (non-windowed) path.
 *
 * `position: sticky` cannot do this job: the rows live inside a horizontal
 * scroller so long lines can scroll sideways, and a sticky descendant anchors to
 * that box — which never scrolls vertically — so it never engages. (`overflow-y:
 * clip` is not an escape hatch either: beside a non-visible `overflow-x` it
 * computes to `hidden`, still a scrollport.) The viewers therefore dock an
 * overlay copy *outside* the horizontal scroller, driven by measured row
 * geometry, and these tests pin that structure and the switch-over points.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { UnifiedDiffViewer } from '../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import { SideBySideDiffViewer } from '../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer';

const FIRST = 'src/first.ts';
const SECOND = 'src/second.ts';

const TWO_FILE_DIFF = [
    `diff --git a/${FIRST} b/${FIRST}`,
    'index 2793a9ad6..8cd4f108a 100644',
    `--- a/${FIRST}`,
    `+++ b/${FIRST}`,
    '@@ -1,3 +1,3 @@',
    ' context line',
    '-old line',
    '+new line',
    `diff --git a/${SECOND} b/${SECOND}`,
    'new file mode 100644',
    'index 0000000..e69de29',
    '--- /dev/null',
    `+++ b/${SECOND}`,
    '@@ -0,0 +1,1 @@',
    '+brand new',
].join('\n');

/** Viewport top of the host scroll container in every case below. */
const PORT_TOP = 100;

/**
 * Place each banner row at a chosen viewport `top`, as if the host container had
 * been scrolled. Everything else (the scroll container included) reports
 * PORT_TOP, so a row above the edge is one with a smaller `top`.
 */
function mockRowTops(tops: Record<string, number>) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const path = this.getAttribute('data-file-path');
        const isInFlowBanner = path && this.getAttribute('data-testid') === 'diff-file-banner';
        const top = isInFlowBanner ? tops[path] : PORT_TOP;
        return { top, left: 0, right: 800, bottom: top + 24, width: 800, height: 24, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
}

const VIEWERS = [
    { name: 'unified', Viewer: UnifiedDiffViewer },
    { name: 'split', Viewer: SideBySideDiffViewer },
] as const;

describe.each(VIEWERS)('file-name banner docking — $name mode', ({ Viewer }) => {
    afterEach(() => vi.restoreAllMocks());

    /** Render inside a scroll container and settle the initial measurement. */
    function renderScrolled(tops: Record<string, number>, props: Record<string, unknown> = { showFileBanners: true }) {
        mockRowTops(tops);
        const utils = render(
            <div data-testid="scroller" style={{ overflowY: 'scroll', height: 600 }}>
                <Viewer diff={TWO_FILE_DIFF} data-testid="diff" {...props} />
            </div>
        );
        return utils;
    }

    /** Re-place the rows and fire a scroll, the way the host container would. */
    function scrollTo(container: HTMLElement, tops: Record<string, number>) {
        mockRowTops(tops);
        act(() => {
            container.querySelector('[data-testid="scroller"]')!.dispatchEvent(new Event('scroll'));
        });
    }

    const docked = (container: HTMLElement) =>
        container.querySelector<HTMLElement>('[data-testid="diff-file-banner-pinned"]');

    it('docks nothing while the first file owns the top edge', () => {
        // Its own in-flow row is right there — docking would show it twice.
        const { container } = renderScrolled({ [FIRST]: PORT_TOP, [SECOND]: PORT_TOP + 300 });
        expect(docked(container)).toBeNull();
    });

    it('docks the current file once its row scrolls above the top edge', () => {
        const { container } = renderScrolled({ [FIRST]: PORT_TOP, [SECOND]: PORT_TOP + 300 });
        scrollTo(container, { [FIRST]: PORT_TOP - 50, [SECOND]: PORT_TOP + 250 });

        expect(docked(container)!.getAttribute('data-file-path')).toBe(FIRST);
    });

    it('hands the dock over when the next file reaches the edge', () => {
        const { container } = renderScrolled({ [FIRST]: PORT_TOP, [SECOND]: PORT_TOP + 300 });
        scrollTo(container, { [FIRST]: PORT_TOP - 400, [SECOND]: PORT_TOP - 1 });

        expect(docked(container)!.getAttribute('data-file-path')).toBe(SECOND);
        // Exactly one docked banner at any offset — never one per file.
        expect(container.querySelectorAll('[data-testid="diff-file-banner-pinned"]')).toHaveLength(1);
    });

    it('un-docks when scrolled back to the top', () => {
        const { container } = renderScrolled({ [FIRST]: PORT_TOP, [SECOND]: PORT_TOP + 300 });
        scrollTo(container, { [FIRST]: PORT_TOP - 400, [SECOND]: PORT_TOP - 1 });
        expect(docked(container)).toBeTruthy();

        scrollTo(container, { [FIRST]: PORT_TOP, [SECOND]: PORT_TOP + 300 });
        expect(docked(container)).toBeNull();
    });

    it('keeps the dock outside the horizontal scroller, in a zero-height sticky wrapper', () => {
        const { container } = renderScrolled({ [FIRST]: PORT_TOP, [SECOND]: PORT_TOP + 300 });
        scrollTo(container, { [FIRST]: PORT_TOP - 50, [SECOND]: PORT_TOP + 250 });

        const pinned = docked(container)!;
        // Inside `overflow-x-auto` the sticky wrapper would anchor to a box that
        // never scrolls vertically — the bug this structure exists to avoid. It
        // also keeps the dock still while long lines scroll sideways.
        expect(pinned.closest('.overflow-x-auto')).toBeNull();

        const wrapper = pinned.parentElement!.parentElement!;
        expect(wrapper.className).toContain('sticky');
        expect(wrapper.className).toContain('top-0');
        expect(wrapper.className).toContain('h-0');
        expect(wrapper.parentElement).toBe(container.querySelector('[data-testid="diff"]'));
    });

    it('docks nothing when banners are off', () => {
        const { container } = renderScrolled({ [FIRST]: PORT_TOP - 400, [SECOND]: PORT_TOP - 1 }, {});
        scrollTo(container, { [FIRST]: PORT_TOP - 400, [SECOND]: PORT_TOP - 1 });

        expect(docked(container)).toBeNull();
        expect(container.querySelector('[data-testid="diff-file-banner"]')).toBeNull();
    });
});
