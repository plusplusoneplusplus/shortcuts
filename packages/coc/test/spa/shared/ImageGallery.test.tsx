/**
 * Tests for ImageGallery — read-only thumbnail gallery with lightbox.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ImageGallery } from '../../../src/server/spa/client/react/shared/ImageGallery';

afterEach(() => {
    vi.restoreAllMocks();
});

const IMG_A = 'data:image/png;base64,aaaa';
const IMG_B = 'data:image/jpeg;base64,bbbb';

describe('ImageGallery', () => {
    it('renders nothing when images is empty', () => {
        const { container } = render(<ImageGallery images={[]} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing when images is undefined', () => {
        const { container } = render(<ImageGallery images={undefined as any} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders one thumbnail per image', () => {
        render(<ImageGallery images={[IMG_A, IMG_B]} />);
        const imgs = screen.getAllByRole('img');
        expect(imgs).toHaveLength(2);
        expect(imgs[0].getAttribute('src')).toBe(IMG_A);
        expect(imgs[1].getAttribute('src')).toBe(IMG_B);
        expect(imgs[0].getAttribute('alt')).toBe('Attached image 1');
        expect(imgs[1].getAttribute('alt')).toBe('Attached image 2');
    });

    it('renders gallery items with data-testid', () => {
        render(<ImageGallery images={[IMG_A]} />);
        expect(screen.getByTestId('image-gallery')).toBeTruthy();
        expect(screen.getByTestId('image-gallery-item')).toBeTruthy();
    });

    it('clicking a thumbnail opens the lightbox overlay', () => {
        render(<ImageGallery images={[IMG_A]} />);
        expect(screen.queryByTestId('image-lightbox')).toBeNull();

        fireEvent.click(screen.getByTestId('image-gallery-item'));
        expect(screen.getByTestId('image-lightbox')).toBeTruthy();

        // Lightbox image should use the full src
        const lightboxImg = screen.getByTestId('image-lightbox').querySelector('img');
        expect(lightboxImg?.getAttribute('src')).toBe(IMG_A);
    });

    it('clicking the backdrop closes the lightbox', () => {
        render(<ImageGallery images={[IMG_A]} />);
        fireEvent.click(screen.getByTestId('image-gallery-item'));
        expect(screen.getByTestId('image-lightbox')).toBeTruthy();

        // Click the backdrop (the overlay div itself)
        fireEvent.click(screen.getByTestId('image-lightbox'));
        expect(screen.queryByTestId('image-lightbox')).toBeNull();
    });

    it('pressing Escape closes the lightbox', () => {
        render(<ImageGallery images={[IMG_A]} />);
        fireEvent.click(screen.getByTestId('image-gallery-item'));
        expect(screen.getByTestId('image-lightbox')).toBeTruthy();

        fireEvent.keyDown(screen.getByTestId('image-lightbox'), { key: 'Escape' });
        expect(screen.queryByTestId('image-lightbox')).toBeNull();
    });

    it('applies custom className', () => {
        render(<ImageGallery images={[IMG_A]} className="my-custom" />);
        expect(screen.getByTestId('image-gallery').className).toContain('my-custom');
    });
});
