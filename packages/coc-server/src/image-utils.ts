/**
 * Image Utilities
 *
 * Shared image helpers for decoding base64 data URL images into temp files
 * and producing SDK Attachment objects. Pure Node.js (no VS Code deps).
 *
 * Replicates the pattern from src/shortcuts/tasks-viewer/ai-task-commands.ts
 * adapted for server context.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Attachment } from '@plusplusoneplusplus/pipeline-core';

/**
 * Parse a base64 data URL into its components.
 * Returns null for invalid or non-image data URLs.
 */
export function parseDataUrl(
    dataUrl: string,
): { mimeType: string; extension: string; buffer: Buffer } | null {
    const match = dataUrl.match(/^data:(image\/(\w+));base64,(.+)$/s);
    if (!match) { return null; }
    const mimeType = match[1];
    let extension = match[2];
    if (extension === 'jpeg') { extension = 'jpg'; }
    try {
        const buffer = Buffer.from(match[3], 'base64');
        return { mimeType, extension, buffer };
    } catch {
        return null;
    }
}

/**
 * Decode base64 data URL images into temp files for SDK attachment.
 * Creates a single temp directory containing all image files.
 * Returns empty arrays if all images are invalid (never throws).
 */
export function saveImagesToTempFiles(
    images: string[],
): { tempDir: string; attachments: Attachment[] } {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-images-'));
    const attachments: Attachment[] = [];

    for (let i = 0; i < images.length; i++) {
        const parsed = parseDataUrl(images[i]);
        if (!parsed) { continue; }
        const filePath = path.join(tempDir, `image-${i}.${parsed.extension}`);
        fs.writeFileSync(filePath, parsed.buffer);
        attachments.push({ type: 'file', path: filePath });
    }

    return { tempDir, attachments };
}

/**
 * Fast check whether a string is a base64 image data URL.
 * Unlike `parseDataUrl`, this does not decode the buffer — O(1) regex test only.
 */
export function isImageDataUrl(value: string): boolean {
    return /^data:image\/[\w+]+;base64,.+/.test(value);
}

/** Best-effort cleanup of a temp directory and its contents. */
export function cleanupTempDir(tempDir: string): void {
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
}
