/**
 * Image Store
 *
 * Consolidates image/blob storage utilities used by the queue executor:
 * - Blob store for externalizing base64 image data from queue persistence payloads
 * - Temp-file helpers for decoding images into SDK Attachment objects
 * - Rehydration helper for restoring images lazily from external blob files
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { ImageBlobStore } from '../queue/image-blob-store';

export { ImageBlobStore };
export { saveImagesToTempFiles, cleanupTempDir, parseDataUrl, isImageDataUrl } from '../core/image-utils';

/**
 * Rehydrate externalized images into a payload object.
 *
 * When a task payload was persisted with images stripped into a separate blob
 * file (`imagesFilePath`), this helper loads them back into `payload.images`
 * before the task is executed.  Mutates `payload` in place.
 *
 * No-op when `imagesFilePath` is absent or `images` is already populated.
 */
export async function rehydrateImagesIfNeeded(payload: any): Promise<void> {
    if (payload?.imagesFilePath && (!Array.isArray(payload.images) || payload.images.length === 0)) {
        payload.images = await ImageBlobStore.loadImages(payload.imagesFilePath);
    }
}
