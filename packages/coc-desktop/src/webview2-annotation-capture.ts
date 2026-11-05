import { nativeImage } from 'electron';
import { annotationPixelCrop } from './browser-annotation-crop';
import type { BrowserAnnotationRect } from './browser-annotation-dom';
import type { BrowserAnnotationPageSnapshot } from './browser-annotation-snapshot';
import type { BrowserAnnotationImage } from './browser-host-contract';

export async function captureWebView2Annotation(
    capturePreview: () => Promise<unknown>,
    rect: BrowserAnnotationRect, viewport: BrowserAnnotationPageSnapshot['viewport'],
): Promise<BrowserAnnotationImage> {
    const dpr = viewport.devicePixelRatio;
    if (![dpr, viewport.width, viewport.height, rect.width, rect.height].every(n => Number.isFinite(n) && n > 0)
        || ![rect.x, rect.y].every(n => Number.isFinite(n) && n >= 0)
        || rect.x + rect.width > viewport.width || rect.y + rect.height > viewport.height) {
        throw new Error('Invalid annotation capture geometry.');
    }
    // The rounded layout viewport differs from the surface by up to one CSS pixel plus half a DIP;
    // page zoom is at least 50%, so half a DIP is at most one CSS pixel.
    const slack = Math.ceil(2 * dpr) + 1;
    const viewportPixels = Math.ceil(viewport.width * dpr) * Math.ceil(viewport.height * dpr);
    if (!Number.isSafeInteger(viewportPixels) || viewportPixels > 16_777_216) throw new Error('Annotation preview is too large.');
    const dataUrl = await capturePreview();
    const prefix = 'data:image/png;base64,';
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix) || dataUrl.length > prefix.length + 27_962_028
        || (dataUrl.length - prefix.length) % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataUrl.slice(prefix.length))) {
        throw new Error('Invalid annotation preview PNG.');
    }
    const png = Buffer.from(dataUrl.slice(prefix.length), 'base64');
    if (png.length < 24 || png.length > 20_971_520 || png.toString('base64') !== dataUrl.slice(prefix.length)
        || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR') {
        throw new Error('Invalid annotation preview PNG.');
    }
    const previewWidth = png.readUInt32BE(16), previewHeight = png.readUInt32BE(20);
    if (!previewWidth || !previewHeight || previewWidth * previewHeight > 16_777_216
        || Math.abs(previewWidth - viewport.width * dpr) > slack
        || Math.abs(previewHeight - viewport.height * dpr) > slack) {
        throw new Error('Annotation preview does not match the selection viewport.');
    }
    const crop = annotationPixelCrop(rect, viewport, { x: 0, y: 0, width: previewWidth, height: previewHeight }, slack);
    // CapturePreview contains the entire viewport in physical pixels, including page zoom.
    const pixels = nativeImage.createFromBuffer(png);
    const size = pixels.getSize();
    if (pixels.isEmpty() || size.width !== previewWidth || size.height !== previewHeight) throw new Error('Invalid annotation preview pixels.');
    const cropped = pixels.crop(crop).toPNG();
    if (!cropped.length || cropped.length > 20_971_520) throw new Error('Annotation PNG is empty or too large.');
    return { dataUrl: `${prefix}${cropped.toString('base64')}`, width: crop.width, height: crop.height };
}
