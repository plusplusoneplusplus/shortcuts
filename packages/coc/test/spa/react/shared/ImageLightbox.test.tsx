/**
 * Tests for ImageLightbox shared component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageLightbox } from '../../../../src/server/spa/client/react/ui/ImageLightbox';

describe('ImageLightbox', () => {
    it('renders nothing when src is null', () => {
        const { container } = render(
            <ImageLightbox src={null} onClose={vi.fn()} />
        );
        expect(container.innerHTML).toBe('');
        expect(screen.queryByTestId('image-lightbox')).toBeNull();
    });

    it('renders lightbox when src is provided', () => {
        render(
            <ImageLightbox src="data:image/png;base64,abc" alt="test" onClose={vi.fn()} />
        );
        expect(screen.getByTestId('image-lightbox')).toBeTruthy();
    });

    it('renders the image with provided src and alt', () => {
        render(
            <ImageLightbox src="data:image/png;base64,abc" alt="My Image" onClose={vi.fn()} />
        );
        const img = document.querySelector('img') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.src).toBe('data:image/png;base64,abc');
        expect(img.alt).toBe('My Image');
    });

    it('calls onClose when overlay backdrop is clicked', () => {
        const onClose = vi.fn();
        render(<ImageLightbox src="data:image/png;base64,abc" onClose={onClose} />);
        fireEvent.click(screen.getByTestId('image-lightbox'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = vi.fn();
        render(<ImageLightbox src="data:image/png;base64,abc" onClose={onClose} />);
        fireEvent.click(screen.getByTestId('lightbox-close'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when image itself is clicked', () => {
        const onClose = vi.fn();
        render(<ImageLightbox src="data:image/png;base64,abc" onClose={onClose} />);
        const img = document.querySelector('img') as HTMLImageElement;
        fireEvent.click(img);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('calls onClose when Escape key is pressed', () => {
        const onClose = vi.fn();
        render(<ImageLightbox src="data:image/png;base64,abc" onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not attach Escape handler when src is null', () => {
        const onClose = vi.fn();
        render(<ImageLightbox src={null} onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });
});
