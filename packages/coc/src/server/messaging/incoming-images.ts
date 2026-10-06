import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import {
    downloadInboundImage, ImageDownloadError, type InboundImage,
} from '@plusplusoneplusplus/coc-connector';
import {
    MAX_ATTACHMENT_SIZE, processMessageAttachments, type AttachmentPayload,
} from '../core/attachment-utils';
import { cleanupTempDir } from '../core/image-utils';
import { getRepoDataPath } from '../paths';

/** Matches the existing chat image persistence limit; never truncate an intended batch. */
export const MAX_MESSAGING_IMAGES = 5;
export const MAX_MESSAGING_IMAGE_BATCH_BYTES = MAX_ATTACHMENT_SIZE;
const DOWNLOAD_TIMEOUT_MS = 30_000;

export class IncomingImagesError extends Error {
    constructor(readonly code: 'batch-limit' | 'workspace' | 'storage') {
        super({
            'batch-limit': `Send at most ${MAX_MESSAGING_IMAGES} images at a time.`,
            workspace: 'Select a local repository before sending images.',
            storage: 'Could not save the images. Check server storage and send them again.',
        }[code]);
        this.name = 'IncomingImagesError';
    }
}

/** Prepared files and durable history carried together into a messaging turn. */
export type PreparedIncomingImages = ReturnType<typeof processMessageAttachments>;

/** Existing chat payload fields; keep SDK files and persisted image history together. */
export function incomingImageTaskPayload(images?: PreparedIncomingImages) {
    return images ? {
        attachments: images.sdkAttachments,
        imageTempDir: images.imageTempDir,
        images: images.validatedImages,
    } : {};
}

/**
 * Call only after durable inbound admission and local workspace resolution.
 * Downloads the entire batch before writing files; rejects rather than returning
 * an incomplete turn. The caller owns imageTempDir until delivery transfers it
 * to the existing executor cleanup lifecycle (or pending-image retention).
 */
export async function prepareIncomingImages(
    dataDir: string,
    workspaceId: string,
    images: readonly InboundImage[],
    signal?: AbortSignal,
): Promise<ReturnType<typeof processMessageAttachments>> {
    // Workspace identifiers must be one portable path segment, never provider input paths.
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(workspaceId)) {
        throw new IncomingImagesError('workspace');
    }
    if (images.length === 0 || images.length > MAX_MESSAGING_IMAGES) {
        throw new IncomingImagesError('batch-limit');
    }

    const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
    const payloads: AttachmentPayload[] = [];
    let remainingBytes = MAX_MESSAGING_IMAGE_BATCH_BYTES;
    for (const image of images) {
        if (signal?.aborted) throw new ImageDownloadError('cancelled');
        const timeoutMs = deadline - Date.now();
        if (timeoutMs <= 0) throw new ImageDownloadError('timeout');
        if (remainingBytes <= 0) throw new ImageDownloadError('size-limit');
        // Recheck bytes and response MIME at the storage boundary. This also bounds
        // acquisition when a transport does not settle promptly after cancellation.
        const buffer = await downloadInboundImage(() => image.mimeType, async downloadSignal =>
            Readable.from([await image.download({ maxBytes: remainingBytes, timeoutMs, signal: downloadSignal })]),
        { maxBytes: remainingBytes, timeoutMs, signal });
        remainingBytes -= buffer.length;
        payloads.push({
            name: `image-${payloads.length + 1}`,
            mimeType: image.mimeType,
            size: buffer.length,
            dataUrl: `data:${image.mimeType};base64,${buffer.toString('base64')}`,
        });
    }

    if (signal?.aborted) throw new ImageDownloadError('cancelled');
    let tempDir: string | undefined;
    try {
        const root = getRepoDataPath(path.resolve(dataDir), workspaceId, 'attachments');
        fs.mkdirSync(root, { recursive: true });
        tempDir = fs.mkdtempSync(path.join(root, 'incoming-'));
        const result = processMessageAttachments({ attachments: payloads }, tempDir);
        if (result.sdkAttachments.length !== images.length
            || result.validatedImages?.length !== images.length
            || result.fileAttachmentMeta?.length !== images.length) {
            throw new IncomingImagesError('storage');
        }
        return result;
    } catch {
        if (tempDir) cleanupTempDir(tempDir);
        throw new IncomingImagesError('storage');
    }
}
