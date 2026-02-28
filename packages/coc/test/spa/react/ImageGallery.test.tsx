/**
 * Tests for ImageGallery — loading state and normal rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImageGallery } from '../../../src/server/spa/client/react/shared/ImageGallery';

vi.mock('../../../src/server/spa/client/react/shared/ImageLightbox', () => ({
    ImageLightbox: () => null,
}));

const IMG_A = 'data:image/png;base64,aaaa';
const IMG_B = 'data:image/jpeg;base64,bbbb';

describe('ImageGallery', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders skeleton placeholders when loading is true', () => {
        render(<ImageGallery images={[]} loading={true} imagesCount={3} />);
        const loading = screen.getByTestId('image-gallery-loading');
        expect(loading).toBeTruthy();
        const skeletons = screen.getAllByTestId('image-gallery-skeleton');
        expect(skeletons).toHaveLength(3);
        // Verify animate-pulse class
        expect(skeletons[0].className).toContain('animate-pulse');
    });

    it('renders single skeleton when loading with no imagesCount', () => {
        render(<ImageGallery images={[]} loading={true} />);
        const skeletons = screen.getAllByTestId('image-gallery-skeleton');
        expect(skeletons).toHaveLength(1);
    });

    it('renders images normally when loading is false', () => {
        render(<ImageGallery images={[IMG_A, IMG_B]} />);
        expect(screen.getByTestId('image-gallery')).toBeTruthy();
        const imgs = screen.getAllByRole('img');
        expect(imgs).toHaveLength(2);
    });

    it('renders nothing when loading is false and images is empty', () => {
        const { container } = render(<ImageGallery images={[]} />);
        expect(container.innerHTML).toBe('');
    });
});
