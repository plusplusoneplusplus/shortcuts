/**
 * Image Blob Store Tests
 *
 * Tests for ImageBlobStore static methods:
 * - saveImages: writes file to correct path, atomic write, handles empty/null
 * - loadImages: reads saved file, returns [] for missing/corrupt/non-array
 * - deleteImages: removes file, no-op for missing file
 * - getBlobsDir: returns correct path
 *
 * Uses OS temp directories for cross-platform compatibility.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ImageBlobStore } from '../../src/server/image-blob-store';

describe('ImageBlobStore', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-blob-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // ========================================================================
    // saveImages
    // ========================================================================

    describe('saveImages', () => {
        it('should write file to correct path', async () => {
            const images = ['data:image/png;base64,abc'];
            const filePath = await ImageBlobStore.saveImages('task-1', images, tmpDir);

            expect(filePath).toBe(path.join(tmpDir, 'blobs', 'task-1.images.json'));
            const content = await fs.readFile(filePath!, 'utf-8');
            expect(content).toBe(JSON.stringify(images));
        });

        it('should create blobs/ directory on first write', async () => {
            const blobsDir = path.join(tmpDir, 'blobs');

            // Directory should not exist yet
            await expect(fs.access(blobsDir)).rejects.toThrow();

            await ImageBlobStore.saveImages('task-2', ['data:image/png;base64,xyz'], tmpDir);

            // Directory should now exist
            const stat = await fs.stat(blobsDir);
            expect(stat.isDirectory()).toBe(true);
        });

        it('should return undefined for empty array', async () => {
            const result = await ImageBlobStore.saveImages('task-3', [], tmpDir);

            expect(result).toBeUndefined();

            // No file or directory should be created
            const blobsDir = path.join(tmpDir, 'blobs');
            await expect(fs.access(blobsDir)).rejects.toThrow();
        });

        it('should return undefined for null/undefined images', async () => {
            const result1 = await ImageBlobStore.saveImages('task-4', null as unknown as string[], tmpDir);
            const result2 = await ImageBlobStore.saveImages('task-5', undefined as unknown as string[], tmpDir);

            expect(result1).toBeUndefined();
            expect(result2).toBeUndefined();
        });

        it('should overwrite existing file for same taskId', async () => {
            const first = ['data:image/png;base64,first'];
            const second = ['data:image/png;base64,second'];

            await ImageBlobStore.saveImages('task-dup', first, tmpDir);
            const filePath = await ImageBlobStore.saveImages('task-dup', second, tmpDir);

            const content = await fs.readFile(filePath!, 'utf-8');
            expect(content).toBe(JSON.stringify(second));
        });

        it('should handle multiple images', async () => {
            const images = [
                'data:image/png;base64,aaa',
                'data:image/jpeg;base64,bbb',
                'data:image/gif;base64,ccc',
            ];

            const filePath = await ImageBlobStore.saveImages('task-multi', images, tmpDir);
            const loaded = await ImageBlobStore.loadImages(filePath!);

            expect(loaded).toEqual(images);
        });
    });

    // ========================================================================
    // loadImages
    // ========================================================================

    describe('loadImages', () => {
        it('should read previously saved images', async () => {
            const images = ['data:image/png;base64,round-trip'];
            const filePath = await ImageBlobStore.saveImages('task-load', images, tmpDir);
            const loaded = await ImageBlobStore.loadImages(filePath!);

            expect(loaded).toEqual(images);
        });

        it('should return empty array for missing file', async () => {
            const result = await ImageBlobStore.loadImages(path.join(tmpDir, 'nonexistent.json'));

            expect(result).toEqual([]);
        });

        it('should return empty array for corrupt JSON', async () => {
            const blobsDir = path.join(tmpDir, 'blobs');
            await fs.mkdir(blobsDir, { recursive: true });
            const filePath = path.join(blobsDir, 'corrupt.images.json');
            await fs.writeFile(filePath, 'not valid json {{{', 'utf-8');

            const result = await ImageBlobStore.loadImages(filePath);

            expect(result).toEqual([]);
        });

        it('should return empty array if file contains non-array JSON', async () => {
            const blobsDir = path.join(tmpDir, 'blobs');
            await fs.mkdir(blobsDir, { recursive: true });

            const filePath1 = path.join(blobsDir, 'string.images.json');
            await fs.writeFile(filePath1, JSON.stringify('hello'), 'utf-8');
            expect(await ImageBlobStore.loadImages(filePath1)).toEqual([]);

            const filePath2 = path.join(blobsDir, 'object.images.json');
            await fs.writeFile(filePath2, JSON.stringify({ key: 'value' }), 'utf-8');
            expect(await ImageBlobStore.loadImages(filePath2)).toEqual([]);
        });
    });

    // ========================================================================
    // deleteImages
    // ========================================================================

    describe('deleteImages', () => {
        it('should remove an existing file', async () => {
            const filePath = await ImageBlobStore.saveImages('task-del', ['data:image/png;base64,del'], tmpDir);
            expect(filePath).toBeDefined();

            await ImageBlobStore.deleteImages(filePath!);

            // File should be gone
            await expect(fs.access(filePath!)).rejects.toThrow();
        });

        it('should be a no-op for missing file', async () => {
            await expect(
                ImageBlobStore.deleteImages(path.join(tmpDir, 'no-such-file.json'))
            ).resolves.toBeUndefined();
        });
    });

    // ========================================================================
    // getBlobsDir
    // ========================================================================

    describe('getBlobsDir', () => {
        it('should return correct path', () => {
            expect(ImageBlobStore.getBlobsDir('/data')).toBe(path.join('/data', 'blobs'));
        });
    });
});
