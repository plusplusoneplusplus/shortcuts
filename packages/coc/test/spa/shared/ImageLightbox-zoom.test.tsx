/**
 * Tests for ImageLightbox zoom / pan behavior (AC-01).
 *
 * Covers wheel zoom, the zoom-in / zoom-out / reset controls, drag-to-pan
 * without closing, and that Escape / backdrop / close-button dismissal is
 * unaffected by zoom state.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ImageLightbox } from '../../../src/server/spa/client/react/ui/ImageLightbox';

afterEach(() => {
    vi.restoreAllMocks();
});

const IMG_SRC = 'data:image/png;base64,aaaa';

function currentImg(): HTMLImageElement {
    return screen.getByTestId('image-lightbox').querySelector('img') as HTMLImageElement;
}

function currentScale(): number {
    const transform = currentImg().style.transform;
    const m = transform.match(/scale\(([-0-9.]+)\)/);
    return m ? parseFloat(m[1]) : NaN;
}

function currentTranslate(): { x: number; y: number } {
    const transform = currentImg().style.transform;
    const m = transform.match(/translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/);
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: NaN, y: NaN };
}

describe('ImageLightbox — zoom and pan', () => {
    it('opens fit-to-screen at scale 1 with no offset', () => {
        render(<ImageLightbox src={IMG_SRC} onClose={vi.fn()} />);
        expect(currentScale()).toBe(1);
        expect(currentTranslate()).toEqual({ x: 0, y: 0 });
    });

    it('wheel scroll up increases the scale', () => {
        render(<ImageLightbox src={IMG_SRC} onClose={vi.fn()} />);
        const overlay = screen.getByTestId('image-lightbox');
        fireEvent.wheel(overlay, { deltaY: -200, clientX: 0, clientY: 0 });
        expect(currentScale()).toBeGreaterThan(1);
    });

    it('zoom-in button increases scale, zoom-out returns toward fit', () => {
        render(<ImageLightbox src={IMG_SRC} onClose={vi.fn()} />);
        fireEvent.click(screen.getByTestId('lightbox-zoom-in'));
        const zoomed = currentScale();
        expect(zoomed).toBeGreaterThan(1);

        fireEvent.click(screen.getByTestId('lightbox-zoom-out'));
        expect(currentScale()).toBeLessThan(zoomed);
    });

    it('reset button returns to fit-to-screen and re-centers', () => {
        render(<ImageLightbox src={IMG_SRC} onClose={vi.fn()} />);
        fireEvent.click(screen.getByTestId('lightbox-zoom-in'));
        fireEvent.click(screen.getByTestId('lightbox-zoom-in'));
        expect(currentScale()).toBeGreaterThan(1);

        fireEvent.click(screen.getByTestId('lightbox-reset'));
        expect(currentScale()).toBe(1);
        expect(currentTranslate()).toEqual({ x: 0, y: 0 });
    });

    it('zoom-out and reset are disabled at fit; zoom-in is enabled', () => {
        render(<ImageLightbox src={IMG_SRC} onClose={vi.fn()} />);
        expect(screen.getByTestId('lightbox-zoom-out')).toBeDisabled();
        expect(screen.getByTestId('lightbox-reset')).toBeDisabled();
        expect(screen.getByTestId('lightbox-zoom-in')).not.toBeDisabled();
    });

    it('dragging a zoomed image pans it without closing the lightbox', () => {
        const onClose = vi.fn();
        render(<ImageLightbox src={IMG_SRC} onClose={onClose} />);

        // Zoom in so panning is enabled.
        fireEvent.click(screen.getByTestId('lightbox-zoom-in'));
        expect(currentTranslate()).toEqual({ x: 0, y: 0 });

        const img = currentImg();
        fireEvent.mouseDown(img, { clientX: 100, clientY: 100 });
        fireEvent.mouseMove(window, { clientX: 160, clientY: 130 });
        fireEvent.mouseUp(window, { clientX: 160, clientY: 130 });

        const { x, y } = currentTranslate();
        expect(x).toBeCloseTo(60, 5);
        expect(y).toBeCloseTo(30, 5);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('does not start a pan drag when at fit scale', () => {
        render(<ImageLightbox src={IMG_SRC} onClose={vi.fn()} />);
        const img = currentImg();
        fireEvent.mouseDown(img, { clientX: 100, clientY: 100 });
        fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
        fireEvent.mouseUp(window, { clientX: 200, clientY: 200 });
        expect(currentTranslate()).toEqual({ x: 0, y: 0 });
    });

    it('double-clicking the image toggles zoom and back to fit', () => {
        render(<ImageLightbox src={IMG_SRC} onClose={vi.fn()} />);
        const img = currentImg();
        fireEvent.doubleClick(img);
        expect(currentScale()).toBeGreaterThan(1);
        fireEvent.doubleClick(img);
        expect(currentScale()).toBe(1);
    });

    it('resets zoom/pan when a new image opens', () => {
        const { rerender } = render(<ImageLightbox src={IMG_SRC} onClose={vi.fn()} />);
        fireEvent.click(screen.getByTestId('lightbox-zoom-in'));
        expect(currentScale()).toBeGreaterThan(1);

        rerender(<ImageLightbox src="data:image/png;base64,bbbb" onClose={vi.fn()} />);
        expect(currentScale()).toBe(1);
    });

    it('Escape, backdrop, and close button still close regardless of zoom', () => {
        // Escape
        const onCloseEsc = vi.fn();
        const { unmount } = render(<ImageLightbox src={IMG_SRC} onClose={onCloseEsc} />);
        fireEvent.click(screen.getByTestId('lightbox-zoom-in'));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onCloseEsc).toHaveBeenCalledTimes(1);
        unmount();

        // Backdrop
        const onCloseBackdrop = vi.fn();
        const { unmount: unmount2 } = render(<ImageLightbox src={IMG_SRC} onClose={onCloseBackdrop} />);
        fireEvent.click(screen.getByTestId('image-lightbox'));
        expect(onCloseBackdrop).toHaveBeenCalledTimes(1);
        unmount2();

        // Close button
        const onCloseBtn = vi.fn();
        render(<ImageLightbox src={IMG_SRC} onClose={onCloseBtn} />);
        fireEvent.click(screen.getByTestId('lightbox-zoom-in'));
        fireEvent.click(screen.getByTestId('lightbox-close'));
        expect(onCloseBtn).toHaveBeenCalledTimes(1);
    });

    it('clicking a zoom control does not close the lightbox', () => {
        const onClose = vi.fn();
        render(<ImageLightbox src={IMG_SRC} onClose={onClose} />);
        fireEvent.click(screen.getByTestId('lightbox-zoom-in'));
        expect(onClose).not.toHaveBeenCalled();
    });
});
