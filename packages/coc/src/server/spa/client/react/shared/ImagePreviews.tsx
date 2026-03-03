import { useState } from 'react';
import { cn } from './cn';
import { ImageLightbox } from './ImageLightbox';

export interface ImagePreviewsProps {
    /** Base64 data URL strings to show as thumbnails */
    images: string[];
    /** Called with the index of the image to remove */
    onRemove: (index: number) => void;
    /** If true, show a paste hint when there are no images */
    showHint?: boolean;
    /** Optional additional className on the outer container */
    className?: string;
    /** data-testid for testing */
    'data-testid'?: string;
}

export function ImagePreviews({ images, onRemove, showHint, className, ...props }: ImagePreviewsProps) {
    const [viewIndex, setViewIndex] = useState<number | null>(null);

    if (images.length === 0 && !showHint) return null;

    return (
        <>
            <div className={cn('flex flex-wrap gap-2 mt-2', className)} data-testid={props['data-testid']}>
                {images.map((dataUrl, index) => (
                    <div
                        key={index}
                        className="group relative w-12 h-12 rounded overflow-hidden border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#2d2d2d]"
                        data-testid="image-preview-item"
                    >
                        <img
                            src={dataUrl}
                            alt={`Pasted image ${index + 1}`}
                            className="w-full h-full object-cover cursor-zoom-in"
                            onClick={() => setViewIndex(index)}
                        />
                        <button
                            onClick={(e) => { e.stopPropagation(); onRemove(index); }}
                            title="Remove image"
                            data-testid={`remove-image-${index}`}
                            className="absolute top-0 right-0 w-8 h-8 rounded-bl-md bg-black/60 text-white text-xs flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity cursor-pointer border-none"
                        >
                            ×
                        </button>
                    </div>
                ))}
                {images.length === 0 && showHint && (
                    <span className="text-[11px] text-[#a0a0a0] dark:text-[#666]">
                        💡 Paste images (Ctrl+V)
                    </span>
                )}
            </div>
            <ImageLightbox
                src={viewIndex !== null ? images[viewIndex] : null}
                alt={viewIndex !== null ? `Pasted image ${viewIndex + 1}` : undefined}
                onClose={() => setViewIndex(null)}
            />
        </>
    );
}
