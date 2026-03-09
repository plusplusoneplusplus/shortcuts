/**
 * Image Blob Store
 *
 * Externalizes base64 image data-URLs from queue persistence payloads
 * into standalone JSON files under `<dataDir>/blobs/`.
 *
 * Uses atomic writes (temp file + rename) matching the safety pattern
 * established in QueuePersistence.atomicWrite.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs/promises';
import * as path from 'path';

const BLOBS_SUBDIR = 'blobs';

export class ImageBlobStore {
    /**
     * Write images to `<dataDir>/blobs/<taskId>.images.json`.
     * Creates the blobs/ directory on first write.
     * Returns the absolute file path, or undefined if images array is empty/missing.
     */
    static async saveImages(
        taskId: string,
        images: string[],
        dataDir: string,
    ): Promise<string | undefined> {
        if (!images || images.length === 0) { return undefined; }
        const dir = path.join(dataDir, BLOBS_SUBDIR);
        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, `${taskId}.images.json`);
        const tmpPath = filePath + '.tmp';
        try {
            await fs.writeFile(tmpPath, JSON.stringify(images), 'utf-8');
            await fs.rename(tmpPath, filePath);
            return filePath;
        } catch {
            try { await fs.unlink(tmpPath); } catch { /* ignore */ }
            return undefined;
        }
    }

    /**
     * Read a previously saved images file.
     * Returns the string array, or [] on any error (missing file, corrupt JSON, wrong shape).
     */
    static async loadImages(filePath: string): Promise<string[]> {
        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /**
     * Delete a saved images file (cleanup helper). Silent on ENOENT.
     */
    static async deleteImages(filePath: string): Promise<void> {
        try { await fs.unlink(filePath); } catch { /* ignore */ }
    }

    /**
     * Returns the blobs directory path for a given data directory.
     */
    static getBlobsDir(dataDir: string): string {
        return path.join(dataDir, BLOBS_SUBDIR);
    }
}
