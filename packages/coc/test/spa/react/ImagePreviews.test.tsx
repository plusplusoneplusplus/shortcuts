import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ImagePreviews } from '../../../src/server/spa/client/react/shared/ImagePreviews';

afterEach(() => {
    vi.restoreAllMocks();
});

const IMG_A = 'data:image/png;base64,aaaa';
const IMG_B = 'data:image/png;base64,bbbb';

describe('ImagePreviews', () => {
    it('renders nothing when images is empty and showHint is false', () => {
        const { container } = render(<ImagePreviews images={[]} onRemove={vi.fn()} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders hint text when images is empty and showHint is true', () => {
        render(<ImagePreviews images={[]} onRemove={vi.fn()} showHint />);
        expect(screen.getByText(/Paste images/)).toBeTruthy();
    });

    it('renders thumbnails for each image', () => {
        render(<ImagePreviews images={[IMG_A, IMG_B]} onRemove={vi.fn()} data-testid="previews" />);

        const imgs = screen.getAllByRole('img');
        expect(imgs).toHaveLength(2);
        expect(imgs[0].getAttribute('alt')).toBe('Pasted image 1');
        expect(imgs[1].getAttribute('alt')).toBe('Pasted image 2');
        expect(imgs[0].getAttribute('src')).toBe(IMG_A);
        expect(imgs[1].getAttribute('src')).toBe(IMG_B);
    });

    it('remove button calls onRemove with correct index', () => {
        const onRemove = vi.fn();
        render(<ImagePreviews images={[IMG_A, IMG_B]} onRemove={onRemove} />);

        fireEvent.click(screen.getByTestId('remove-image-0'));
        expect(onRemove).toHaveBeenCalledWith(0);

        fireEvent.click(screen.getByTestId('remove-image-1'));
        expect(onRemove).toHaveBeenCalledWith(1);
    });

    it('remove button click stops propagation', () => {
        const parentClick = vi.fn();
        const onRemove = vi.fn();
        render(
            <div onClick={parentClick}>
                <ImagePreviews images={[IMG_A]} onRemove={onRemove} />
            </div>
        );

        fireEvent.click(screen.getByTestId('remove-image-0'));
        expect(onRemove).toHaveBeenCalledWith(0);
        expect(parentClick).not.toHaveBeenCalled();
    });

    it('applies custom className', () => {
        render(<ImagePreviews images={[IMG_A]} onRemove={vi.fn()} className="my-extra" data-testid="previews" />);
        const container = screen.getByTestId('previews');
        expect(container.className).toContain('my-extra');
    });

    it('clicking a thumbnail opens the lightbox', () => {
        render(<ImagePreviews images={[IMG_A]} onRemove={vi.fn()} />);
        expect(screen.queryByTestId('image-lightbox')).toBeNull();

        fireEvent.click(screen.getByRole('img'));
        expect(screen.getByTestId('image-lightbox')).toBeTruthy();

        const lightboxImg = screen.getByTestId('image-lightbox').querySelector('img');
        expect(lightboxImg?.getAttribute('src')).toBe(IMG_A);
    });

    it('remove button does NOT open the lightbox', () => {
        render(<ImagePreviews images={[IMG_A]} onRemove={vi.fn()} />);
        fireEvent.click(screen.getByTestId('remove-image-0'));
        expect(screen.queryByTestId('image-lightbox')).toBeNull();
    });

    it('closing the lightbox returns to thumbnail view', () => {
        render(<ImagePreviews images={[IMG_A]} onRemove={vi.fn()} />);

        fireEvent.click(screen.getByRole('img'));
        expect(screen.getByTestId('image-lightbox')).toBeTruthy();

        // Click backdrop to close
        fireEvent.click(screen.getByTestId('image-lightbox'));
        expect(screen.queryByTestId('image-lightbox')).toBeNull();
    });
});
