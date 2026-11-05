import { nativeImage, type WebContents } from 'electron';
import { annotationPixelCrop } from './browser-annotation-crop';
import type { BrowserAnnotationRect } from './browser-annotation-dom';
import type { BrowserAnnotationPageSnapshot } from './browser-annotation-snapshot';
import type { BrowserAnnotationImage } from './browser-host-contract';

/** Nearest DIP at or before `dip` that starts on a whole device pixel; zero always does. */
function alignedOrigin(dip: number, scale: number): number {
    for (let value = Math.floor(dip), stop = Math.max(0, value - 256); value > stop; value--) {
        const pixels = value * scale;
        if (Math.abs(pixels - Math.round(pixels)) <= pixels * 1e-6) return value;
    }
    return 0;
}

/** Capture DIPs around the selection, then crop its enclosing device pixels without resampling. */
export async function captureElectronAnnotation(
    contents: Pick<WebContents, 'capturePage' | 'getZoomFactor' | 'isDestroyed'>,
    rect: BrowserAnnotationRect, viewport: BrowserAnnotationPageSnapshot['viewport'],
): Promise<BrowserAnnotationImage> {
    const zoom = contents.getZoomFactor();
    const dpr = viewport.devicePixelRatio;
    if (contents.isDestroyed() || ![zoom, dpr, viewport.width, viewport.height, rect.width, rect.height].every(n => Number.isFinite(n) && n > 0)
        || ![rect.x, rect.y].every(n => Number.isFinite(n) && n >= 0)
        || rect.x + rect.width > viewport.width || rect.y + rect.height > viewport.height) {
        throw new Error('Invalid annotation capture geometry.');
    }
    // Device pixels per DIP: page zoom only maps CSS pixels to DIPs.
    const scale = dpr / zoom;
    // Native capture rounds a fractional device origin differently per platform, so start on a
    // whole device pixel. One extra DIP keeps the far edge independent of native rounding.
    const x = alignedOrigin(rect.x * zoom, scale), y = alignedOrigin(rect.y * zoom, scale);
    const capture = {
        x, y,
        width: Math.min(Math.ceil((rect.x + rect.width) * zoom) + 1, Math.ceil(viewport.width * zoom)) - x,
        height: Math.min(Math.ceil((rect.y + rect.height) * zoom) + 1, Math.ceil(viewport.height * zoom)) - y,
    };
    const pixels = Math.ceil(capture.width * scale) * Math.ceil(capture.height * scale);
    if (!Number.isSafeInteger(pixels) || pixels > 16_777_216) throw new Error('Annotation image is too large.');
    const image = await contents.capturePage(capture, { stayHidden: true });
    if (contents.isDestroyed() || contents.getZoomFactor() !== zoom || image.isEmpty()) throw new Error('Annotation capture became unavailable.');
    // Decode the PNG at 1x: NativeImage DIP/scale-factor behavior differs across Electron versions.
    const decoded = nativeImage.createFromBuffer(image.toPNG());
    // The rounded layout viewport exceeds the surface by under one CSS pixel plus half a DIP.
    const crop = annotationPixelCrop(rect, viewport,
        { x: Math.round(x * scale), y: Math.round(y * scale), ...decoded.getSize() }, Math.ceil(dpr + scale / 2) + 1);
    const png = decoded.crop(crop).toPNG();
    if (!png.length || png.length > 20_971_520) throw new Error('Annotation PNG is empty or too large.');
    return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: crop.width, height: crop.height };
}
