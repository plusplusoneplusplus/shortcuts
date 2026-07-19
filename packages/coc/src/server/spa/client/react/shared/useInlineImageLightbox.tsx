/**
 * Shared click-to-lightbox wiring for inline conversation images.
 *
 * Assistant messages render through `MarkdownView` and user messages inject
 * their HTML via `dangerouslySetInnerHTML`, but both emit the same
 * `img.chat-inline-image` markup. This hook centralizes the detection so the
 * two paths open the same `ImageLightbox` with identical rules instead of
 * duplicating the logic.
 */
import { useCallback, useState } from 'react';

/**
 * Resolves the display URL of a clickable inline conversation image.
 *
 * Returns the image's current source when `target` is an
 * `img.chat-inline-image` that has not failed to load, otherwise null. Broken
 * images carry `chat-inline-image--error` and are ignored so clicking a
 * failed-load placeholder does nothing.
 */
export function resolveInlineImageSrc(target: EventTarget | null): string | null {
    if (!(target instanceof HTMLImageElement)) return null;
    if (!target.classList.contains('chat-inline-image')) return null;
    if (target.classList.contains('chat-inline-image--error')) return null;
    return target.currentSrc || target.src || null;
}

/**
 * Lightbox state for inline conversation images.
 *
 * `openFromTarget` inspects a click target and, when it is a clickable inline
 * image, opens the lightbox and returns true — callers use the return value to
 * `preventDefault()` a wrapping link so the image zooms rather than navigates.
 */
export function useInlineImageLightbox() {
    const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

    const openFromTarget = useCallback((target: EventTarget | null): boolean => {
        const src = resolveInlineImageSrc(target);
        if (!src) return false;
        setLightboxSrc(src);
        return true;
    }, []);

    const closeLightbox = useCallback(() => setLightboxSrc(null), []);

    return { lightboxSrc, openFromTarget, closeLightbox };
}
