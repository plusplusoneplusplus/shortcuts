import { useEffect } from 'react';
import ReactDOM from 'react-dom';

export interface ImageLightboxProps {
    /** Base64 data URL to show, or null to hide the lightbox */
    src: string | null;
    alt?: string;
    onClose: () => void;
}

/**
 * Lightweight full-screen overlay for viewing a single image at full size.
 * Renders via portal to document.body (z-index 10003, above Dialog's 10002).
 */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
    useEffect(() => {
        if (!src) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [src, onClose]);

    if (!src) return null;

    return ReactDOM.createPortal(
        <div
            className="fixed inset-0 z-[10003] flex items-center justify-center bg-black/80 cursor-zoom-out"
            data-testid="image-lightbox"
            onClick={onClose}
        >
            <img
                src={src}
                alt={alt}
                className="max-w-[95vw] max-h-[90vh] object-contain rounded shadow-2xl cursor-default"
                onClick={(e) => e.stopPropagation()}
            />
            <button
                className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-black/50 text-white text-lg leading-none cursor-pointer border-none hover:bg-black/70"
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                aria-label="Close lightbox"
                data-testid="lightbox-close"
            >
                ×
            </button>
        </div>,
        document.body
    );
}
