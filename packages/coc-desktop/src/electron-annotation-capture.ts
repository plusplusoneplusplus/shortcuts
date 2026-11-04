import { nativeImage, type WebContents } from 'electron';
import type { BrowserAnnotationRect } from './browser-annotation-dom';
import type { BrowserAnnotationPageSnapshot } from './browser-annotation-snapshot';
import type { BrowserAnnotationImage } from './browser-host-contract';

/** Capture the enclosing DIP rectangle, then trim to enclosing physical selection pixels. */
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
    const left = Math.floor(rect.x * dpr), top = Math.floor(rect.y * dpr);
    const width = Math.ceil((rect.x + rect.width) * dpr) - left;
    const height = Math.ceil((rect.y + rect.height) * dpr) - top;
    if (!Number.isSafeInteger(width * height) || width * height > 16_777_216) throw new Error('Annotation image is too large.');
    const capture = {
        x: Math.floor(rect.x * zoom), y: Math.floor(rect.y * zoom),
        width: Math.ceil((rect.x + rect.width) * zoom) - Math.floor(rect.x * zoom),
        height: Math.ceil((rect.y + rect.height) * zoom) - Math.floor(rect.y * zoom),
    };
    const image = await contents.capturePage(capture, { stayHidden: true });
    if (contents.isDestroyed() || contents.getZoomFactor() !== zoom || image.isEmpty()) throw new Error('Annotation capture became unavailable.');
    // Decode the PNG at 1x: NativeImage DIP/scale-factor behavior differs across Electron versions.
    const pixels = nativeImage.createFromBuffer(image.toPNG());
    const scale = dpr / zoom;
    const crop = { x: left - Math.floor(capture.x * scale), y: top - Math.floor(capture.y * scale), width, height };
    const size = pixels.getSize();
    if (crop.x < 0 || crop.y < 0 || crop.x + width > size.width || crop.y + height > size.height) {
        throw new Error('Annotation capture does not cover the selection.');
    }
    const png = pixels.crop(crop).toPNG();
    if (!png.length || png.length > 20_971_520) throw new Error('Annotation PNG is empty or too large.');
    return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, width, height };
}
