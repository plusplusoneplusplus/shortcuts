/**
 * Tests for ImageLightbox — standalone full-screen overlay for viewing images.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ImageLightbox } from '../../../src/server/spa/client/react/shared/ImageLightbox';

afterEach(() => {
    vi.restoreAllMocks();
});

const IMG_SRC = 'data:image/png;base64,aaaa';

describe('ImageLightbox', () => {
    it('renders nothing when src is null', () => {
        const { container } = render(<ImageLightbox src={null} onClose={vi.fn()} />);
        expect(container.innerHTML).toBe('');
        expect(screen.queryByTestId('image-lightbox')).toBeNull();
    });

    it('renders a portal overlay with the full image when src is provided', () => {
        render(<ImageLightbox src={IMG_SRC} alt="test image" onClose={vi.fn()} />);
        const overlay = screen.getByTestId('image-lightbox');
        expect(overlay).toBeTruthy();

        const img = overlay.querySelector('img');
        expect(img).toBeTruthy();
        expect(img!.getAttribute('src')).toBe(IMG_SRC);
        expect(img!.getAttribute('alt')).toBe('test image');
    });

    it('clicking the backdrop calls onClose', () => {
        const onClose = vi.fn();
        render(<ImageLightbox src={IMG_SRC} onClose={onClose} />);

        fireEvent.click(screen.getByTestId('image-lightbox'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking the image does not call onClose', () => {
        const onClose = vi.fn();
        render(<ImageLightbox src={IMG_SRC} alt="img" onClose={onClose} />);

        const img = screen.getByTestId('image-lightbox').querySelector('img')!;
        fireEvent.click(img);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('pressing Escape calls onClose', () => {
        const onClose = vi.fn();
        render(<ImageLightbox src={IMG_SRC} onClose={onClose} />);

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking the close button calls onClose', () => {
        const onClose = vi.fn();
        render(<ImageLightbox src={IMG_SRC} onClose={onClose} />);

        fireEvent.click(screen.getByTestId('lightbox-close'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not add keydown listener when src is null', () => {
        const addSpy = vi.spyOn(document, 'addEventListener');
        render(<ImageLightbox src={null} onClose={vi.fn()} />);

        const keydownCalls = addSpy.mock.calls.filter(c => c[0] === 'keydown');
        expect(keydownCalls).toHaveLength(0);
    });

    it('renders the close button with accessible label', () => {
        render(<ImageLightbox src={IMG_SRC} onClose={vi.fn()} />);
        expect(screen.getByLabelText('Close lightbox')).toBeTruthy();
    });
});
