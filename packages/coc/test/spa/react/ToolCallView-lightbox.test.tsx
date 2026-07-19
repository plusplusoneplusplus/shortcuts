/**
 * Tests for ToolCallView — click-to-lightbox on tool-result images (AC-04).
 *
 * ToolCallView owns a single ImageLightbox and passes an `openLightbox`
 * callback down to both the hover ToolResultPopover and the expanded
 * ToolCallDetailSections. Owning it here (above the popover) is what lets the
 * lightbox survive when the hover popover unmounts on mouse-leave.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';

function makeToolCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-1',
        toolName: 'test_tool',
        args: {},
        status: 'completed',
        ...overrides,
    };
}

function expandToolCall(container: HTMLElement) {
    const header = container.querySelector('.tool-call-header');
    if (header) fireEvent.click(header);
}

describe('ToolCallView — click-to-lightbox (AC-04)', () => {
    afterEach(() => cleanup());

    it('opens the lightbox when the generic tool-result image is clicked', () => {
        const { container } = render(<ToolCallView toolCall={makeToolCall({ result: PNG })} />);
        expandToolCall(container);

        // No lightbox until the image is clicked.
        expect(screen.queryByTestId('image-lightbox')).toBeNull();

        const img = screen.getByTestId('tool-result-image');
        expect(img.className).toContain('cursor-zoom-in');
        fireEvent.click(img);

        const lightbox = screen.getByTestId('image-lightbox');
        expect(lightbox).toBeTruthy();
        expect(lightbox.querySelector('img')?.getAttribute('src')).toBe(PNG);

        // AC-01 zoom/pan controls reach tool-result images too.
        expect(screen.getByTestId('lightbox-zoom-in')).toBeTruthy();
        expect(screen.getByTestId('lightbox-zoom-out')).toBeTruthy();
        expect(screen.getByTestId('lightbox-reset')).toBeTruthy();
    });

    it('opens the lightbox for a view-tool image (ViewToolView path)', () => {
        const { container } = render(
            <ToolCallView toolCall={{ id: 'v1', toolName: 'view', args: { path: '/tmp/shot.png' }, status: 'completed', result: PNG }} />
        );
        expandToolCall(container);

        const img = screen.getByTestId('tool-result-image');
        fireEvent.click(img);

        const lightbox = screen.getByTestId('image-lightbox');
        expect(lightbox.querySelector('img')?.getAttribute('src')).toBe(PNG);
    });

    it('opens the lightbox for a created image (CreateToolView path)', () => {
        const { container } = render(
            <ToolCallView toolCall={{ id: 'c1', toolName: 'create', args: { path: '/tmp/new.png', file_text: 'PNGBYTES' }, status: 'completed', result: 'File created' }} />
        );
        expandToolCall(container);

        const img = container.querySelector('.file-preview-image') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.className).toContain('cursor-zoom-in');
        fireEvent.click(img);

        expect(screen.getByTestId('image-lightbox')).toBeTruthy();
    });

    it('closes the lightbox via the X button', () => {
        const { container } = render(<ToolCallView toolCall={makeToolCall({ result: PNG })} />);
        expandToolCall(container);

        fireEvent.click(screen.getByTestId('tool-result-image'));
        expect(screen.getByTestId('image-lightbox')).toBeTruthy();

        fireEvent.click(screen.getByTestId('lightbox-close'));
        expect(screen.queryByTestId('image-lightbox')).toBeNull();
    });

    it('keeps the lightbox open after the hover popover unmounts (edge case)', () => {
        vi.useFakeTimers();
        try {
            const { container } = render(
                <ToolCallView toolCall={{ id: 'v2', toolName: 'view', args: { path: '/tmp/shot.png' }, status: 'completed', result: PNG }} />
            );
            const header = container.querySelector('.tool-call-header')!;

            // Desktop hover has a 300ms delay before the popover appears.
            fireEvent.mouseEnter(header);
            act(() => { vi.advanceTimersByTime(300); });

            const popover = screen.getByTestId('tool-result-popover');
            const popoverImg = screen.getByTestId('popover-image');
            expect(popoverImg.className).toContain('cursor-zoom-in');

            fireEvent.click(popoverImg);
            expect(screen.getByTestId('image-lightbox')).toBeTruthy();

            // Moving the mouse away unmounts the popover; the lightbox must survive
            // because ToolCallView owns it (not the popover).
            fireEvent.mouseLeave(popover);
            expect(screen.queryByTestId('tool-result-popover')).toBeNull();
            expect(screen.getByTestId('image-lightbox')).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });
});
