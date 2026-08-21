// @vitest-environment jsdom
/**
 * Tests for FilePreviewTooltip positioning hardening:
 * - a detached anchor dismisses the tooltip instead of rendering at (0,0)
 * - a connected anchor positions the tooltip adjacent to its rect
 * - left is clamped to the viewport; near the bottom the card flips above
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { FilePreviewTooltip } from '../../../../src/server/spa/client/react/features/notes/editor/FilePreviewTooltip';

vi.mock('../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getFilePreview: vi.fn().mockResolvedValue({
            content: 'line 1\nline 2',
            exists: true,
            type: 'file',
        }),
    },
}));

function mockRect(el: HTMLElement, rect: Partial<DOMRect>) {
    el.getBoundingClientRect = () => ({
        top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
        toJSON: () => ({}),
        ...rect,
    } as DOMRect);
}

function connectedAnchor(rect: Partial<DOMRect>): HTMLElement {
    const anchor = document.createElement('a');
    document.body.appendChild(anchor);
    mockRect(anchor, rect);
    return anchor;
}

afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
});

describe('FilePreviewTooltip positioning', () => {
    it('dismisses via onMouseLeave when the anchor is detached', () => {
        // Regression: a ProseMirror redraw can recreate the hovered element
        // while the hover timer is pending; measuring the detached anchor gave
        // an all-zero rect and pinned the tooltip to the top-left corner.
        const detached = document.createElement('a');
        const onMouseLeave = vi.fn();

        render(
            <FilePreviewTooltip
                filePath="src/main.ts"
                workspaceId="ws1"
                anchorEl={detached}
                onMouseLeave={onMouseLeave}
            />,
        );

        expect(onMouseLeave).toHaveBeenCalled();
    });

    it('dismisses when a connected anchor measures an all-zero rect', () => {
        // jsdom rects are all-zero by default, which doubles as the
        // zero-rect-treated-as-detached path.
        const anchor = document.createElement('a');
        document.body.appendChild(anchor);
        const onMouseLeave = vi.fn();

        render(
            <FilePreviewTooltip
                filePath="src/main.ts"
                workspaceId="ws1"
                anchorEl={anchor}
                onMouseLeave={onMouseLeave}
            />,
        );

        expect(onMouseLeave).toHaveBeenCalled();
    });

    it('positions the tooltip just below a connected anchor', () => {
        const anchor = connectedAnchor({ top: 100, bottom: 120, left: 40, width: 80, height: 20 });
        const onMouseLeave = vi.fn();

        render(
            <FilePreviewTooltip
                filePath="src/main.ts"
                workspaceId="ws1"
                anchorEl={anchor}
                onMouseLeave={onMouseLeave}
            />,
        );

        const tooltip = screen.getByTestId('file-preview-tooltip');
        expect(tooltip.style.top).toBe('124px');
        expect(tooltip.style.left).toBe('40px');
        expect(onMouseLeave).not.toHaveBeenCalled();
    });

    it('clamps left so the 360px card stays inside the viewport', () => {
        const nearRight = window.innerWidth - 20;
        const anchor = connectedAnchor({
            top: 100, bottom: 120, left: nearRight, width: 10, height: 20,
        });

        render(
            <FilePreviewTooltip
                filePath="src/main.ts"
                workspaceId="ws1"
                anchorEl={anchor}
            />,
        );

        const tooltip = screen.getByTestId('file-preview-tooltip');
        expect(tooltip.style.left).toBe(`${window.innerWidth - 360 - 8}px`);
    });

    it('flips above the anchor near the bottom of the viewport', () => {
        const bottom = window.innerHeight - 10;
        const anchor = connectedAnchor({
            top: bottom - 20, bottom, left: 40, width: 80, height: 20,
        });

        render(
            <FilePreviewTooltip
                filePath="src/main.ts"
                workspaceId="ws1"
                anchorEl={anchor}
            />,
        );

        const tooltip = screen.getByTestId('file-preview-tooltip');
        // 280 = the card's estimated height used by the flip heuristic
        expect(tooltip.style.top).toBe(`${Math.max(8, bottom - 20 - 4 - 280)}px`);
    });
});
