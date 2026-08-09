/**
 * File-name banner under windowing (diffs over VIRTUALIZE_THRESHOLD lines).
 *
 * Windowed rows are absolutely positioned, so the in-flow sticky banner cannot
 * hold. Both viewers instead pin a single banner for the file that owns the
 * topmost mounted row. The virtualization block mocks offsetHeight/offsetWidth
 * (what @tanstack/react-virtual measures), matching UnifiedDiffViewer.find.test.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
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

    it('pins a banner for the file owning the topmost mounted row', () => {
        const { container } = renderWindowed(
            <Viewer diff={DIFF} showFileBanners data-testid="diff" />
        );
        const pinned = container.querySelector<HTMLElement>('[data-testid="diff-file-banner-pinned"]');
        expect(pinned).toBeTruthy();
        // Scroll position is 0, so the first file owns the topmost row.
        expect(pinned!.getAttribute('data-file-path')).toBe('src/big.ts');
        expect(pinned!.querySelector('[data-testid="diff-file-banner-status"]')!.textContent).toBe('modified');
    });

    it('wraps the pinned banner in a sticky container', () => {
        const { container } = renderWindowed(
            <Viewer diff={DIFF} showFileBanners data-testid="diff" />
        );
        const pinned = container.querySelector<HTMLElement>('[data-testid="diff-file-banner-pinned"]')!;
        // The row itself is not sticky — its wrapper is, since windowed rows are
        // absolutely positioned and cannot participate in sticky flow.
        expect(pinned.className).not.toContain('sticky');
        expect(pinned.parentElement!.className).toContain('sticky');
        expect(pinned.parentElement!.className).toContain('top-0');
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
