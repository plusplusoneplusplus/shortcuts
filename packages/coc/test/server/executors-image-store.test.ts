/**
 * Image Store Tests (executors/image-store)
 *
 * Tests for the consolidated image-store module:
 * - Re-exports: ImageBlobStore, saveImagesToTempFiles, cleanupTempDir, parseDataUrl, isImageDataUrl
 * - rehydrateImagesIfNeeded: lazy image loading from blob store into payload
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Re-export smoke tests
// ============================================================================

import {
    ImageBlobStore,
    saveImagesToTempFiles,
    cleanupTempDir,
    parseDataUrl,
    isImageDataUrl,
    rehydrateImagesIfNeeded,
} from '../../src/server/executors/image-store';

describe('image-store re-exports', () => {
    it('exports ImageBlobStore with static methods', () => {
        expect(typeof ImageBlobStore.saveImages).toBe('function');
        expect(typeof ImageBlobStore.loadImages).toBe('function');
        expect(typeof ImageBlobStore.deleteImages).toBe('function');
        expect(typeof ImageBlobStore.getBlobsDir).toBe('function');
    });

    it('exports saveImagesToTempFiles', () => {
        expect(typeof saveImagesToTempFiles).toBe('function');
    });

    it('exports cleanupTempDir', () => {
        expect(typeof cleanupTempDir).toBe('function');
    });

    it('exports parseDataUrl', () => {
        expect(typeof parseDataUrl).toBe('function');
    });

    it('exports isImageDataUrl', () => {
        expect(typeof isImageDataUrl).toBe('function');
    });
});

// ============================================================================
// rehydrateImagesIfNeeded
// ============================================================================

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_1X1}`;

describe('rehydrateImagesIfNeeded', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-image-store-test-'));
    });

    afterEach(() => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('loads images from blob file when payload.images is empty', async () => {
        // Arrange: save an image to disk
        const filePath = await ImageBlobStore.saveImages('task-x', [PNG_DATA_URL], tmpDir);
        const payload: any = { imagesFilePath: filePath, images: [] };

        // Act
        await rehydrateImagesIfNeeded(payload);

        // Assert
        expect(payload.images).toEqual([PNG_DATA_URL]);
    });

    it('loads images from blob file when payload.images is absent', async () => {
        const filePath = await ImageBlobStore.saveImages('task-y', [PNG_DATA_URL], tmpDir);
        const payload: any = { imagesFilePath: filePath };

        await rehydrateImagesIfNeeded(payload);

        expect(payload.images).toEqual([PNG_DATA_URL]);
    });

    it('does not overwrite existing images', async () => {
        const filePath = await ImageBlobStore.saveImages('task-z', [PNG_DATA_URL], tmpDir);
        const existing = ['data:image/png;base64,existing'];
        const payload: any = { imagesFilePath: filePath, images: existing };

        await rehydrateImagesIfNeeded(payload);

        // Existing images should be preserved
        expect(payload.images).toEqual(existing);
    });

    it('is a no-op when imagesFilePath is absent', async () => {
        const payload: any = { images: [] };

        await rehydrateImagesIfNeeded(payload);

        expect(payload.images).toEqual([]);
    });

    it('is a no-op for null/undefined payload', async () => {
        await expect(rehydrateImagesIfNeeded(null)).resolves.toBeUndefined();
        await expect(rehydrateImagesIfNeeded(undefined)).resolves.toBeUndefined();
    });

    it('sets images to [] when blob file is missing', async () => {
        const payload: any = { imagesFilePath: path.join(tmpDir, 'nonexistent.json'), images: [] };

        await rehydrateImagesIfNeeded(payload);

        expect(payload.images).toEqual([]);
    });
});
