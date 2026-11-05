import type { BrowserAnnotationRect } from './browser-annotation-dom';
import type { BrowserAnnotationPageSnapshot } from './browser-annotation-snapshot';

/** Device-pixel rectangle; `x`/`y` are viewport coordinates of the image's first pixel when used as an image origin. */
export interface BrowserAnnotationPixels {
    x: number;
    y: number;
    width: number;
    height: number;
}

// devicePixelRatio is a float32 product of zoom and display scale; its noise must not add a pixel.
const floorPixel = (value: number) => Math.floor(value + Math.abs(value) * 1e-6);
const ceilPixel = (value: number) => Math.ceil(value - Math.abs(value) * 1e-6);

/**
 * Enclosing device pixels of a CSS selection, relative to `image`. The rounded innerWidth/innerHeight
 * can extend up to `slack` device pixels past a fractional compositor surface; those pixels are never
 * displayed, so a selection reaching them is trimmed to the last displayed pixel.
 */
export function annotationPixelCrop(
    rect: BrowserAnnotationRect, viewport: BrowserAnnotationPageSnapshot['viewport'],
    image: BrowserAnnotationPixels, slack: number,
): BrowserAnnotationPixels {
    const dpr = viewport.devicePixelRatio;
    const axis = (start: number, end: number, origin: number, size: number, viewportEnd: number) => {
        const first = floorPixel(start * dpr), last = Math.min(ceilPixel(end * dpr), origin + size);
        if (first < origin || last <= first
            || (ceilPixel(end * dpr) > last && ceilPixel(viewportEnd * dpr) - (origin + size) > slack)) {
            throw new Error('Annotation capture does not cover the selection.');
        }
        return [first - origin, last - first];
    };
    const [x, width] = axis(rect.x, rect.x + rect.width, image.x, image.width, viewport.width);
    const [y, height] = axis(rect.y, rect.y + rect.height, image.y, image.height, viewport.height);
    return { x, y, width, height };
}
