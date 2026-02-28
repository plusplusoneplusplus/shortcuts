import { useState, useCallback } from 'react';
import { cn } from './cn';
import { ImageLightbox } from './ImageLightbox';

export interface ImageGalleryProps {
    /** Base64 data-URL strings to render as thumbnails */
    images: string[];
    /** Optional additional className on the outer container */
    className?: string;
}

/**
 * Read-only gallery of image thumbnails with click-to-expand lightbox.
 * Used in chat conversation bubbles to display user-attached images.
 */
export function ImageGallery({ images, className }: ImageGalleryProps) {
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

    const closeLightbox = useCallback(() => setLightboxIndex(null), []);

    if (!images || images.length === 0) return null;

    return (
        <>
            <div className={cn('flex flex-wrap gap-2 mt-2', className)} data-testid="image-gallery">
                {images.map((dataUrl, index) => (
                    <div
                        key={index}
                        className="w-16 h-16 rounded overflow-hidden border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#2d2d2d] cursor-pointer"
                        data-testid="image-gallery-item"
                        onClick={() => setLightboxIndex(index)}
                    >
                        <img
                            src={dataUrl}
                            alt={`Attached image ${index + 1}`}
                            className="w-full h-full object-cover"
                        />
                    </div>
                ))}
            </div>
            <ImageLightbox
                src={lightboxIndex !== null ? images[lightboxIndex] : null}
                alt={lightboxIndex !== null ? `Attached image ${lightboxIndex + 1}` : undefined}
                onClose={closeLightbox}
            />
        </>
    );
}
