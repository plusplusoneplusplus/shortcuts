/**
 * Tests for image temp-file helpers used by AI task creation.
 * Covers parseDataUrl, saveImagesToTempFiles, and cleanupTempDir.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    parseDataUrlForTesting as parseDataUrl,
    saveImagesToTempFilesForTesting as saveImagesToTempFiles,
    cleanupTempDirForTesting as cleanupTempDir
} from '../../shortcuts/tasks-viewer/ai-task-commands';

// 1x1 red pixel PNG encoded as base64
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

// Same pixel data re-encoded as JPEG data URL (fabricated but structurally valid)
const TINY_JPEG_BASE64 = '/9j/4AAQSkZJRg==';
const TINY_JPEG_DATA_URL = `data:image/jpeg;base64,${TINY_JPEG_BASE64}`;

// GIF data URL
const TINY_GIF_BASE64 = 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
const TINY_GIF_DATA_URL = `data:image/gif;base64,${TINY_GIF_BASE64}`;

// WebP data URL
const TINY_WEBP_BASE64 = 'UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAAfQ//73fwA=';
const TINY_WEBP_DATA_URL = `data:image/webp;base64,${TINY_WEBP_BASE64}`;

suite('AI Task Image Temp-File Helpers', () => {

    suite('parseDataUrl', () => {
        test('should parse a valid PNG data URL', () => {
            const result = parseDataUrl(TINY_PNG_DATA_URL);
            assert.ok(result, 'Should return a result');
            assert.strictEqual(result!.mimeType, 'image/png');
            assert.strictEqual(result!.extension, 'png');
            assert.ok(Buffer.isBuffer(result!.buffer), 'Should return a Buffer');
            assert.ok(result!.buffer.length > 0, 'Buffer should not be empty');
        });

        test('should parse a valid JPEG data URL and normalise extension to jpg', () => {
            const result = parseDataUrl(TINY_JPEG_DATA_URL);
            assert.ok(result, 'Should return a result');
            assert.strictEqual(result!.mimeType, 'image/jpeg');
            assert.strictEqual(result!.extension, 'jpg', 'jpeg should be normalised to jpg');
        });

        test('should parse a valid GIF data URL', () => {
            const result = parseDataUrl(TINY_GIF_DATA_URL);
            assert.ok(result, 'Should return a result');
            assert.strictEqual(result!.mimeType, 'image/gif');
            assert.strictEqual(result!.extension, 'gif');
        });

        test('should parse a valid WebP data URL', () => {
            const result = parseDataUrl(TINY_WEBP_DATA_URL);
            assert.ok(result, 'Should return a result');
            assert.strictEqual(result!.mimeType, 'image/webp');
            assert.strictEqual(result!.extension, 'webp');
        });

        test('should return null for a non-image data URL', () => {
            const result = parseDataUrl('data:text/plain;base64,SGVsbG8=');
            assert.strictEqual(result, null);
        });

        test('should return null for a malformed string', () => {
            assert.strictEqual(parseDataUrl('not-a-data-url'), null);
            assert.strictEqual(parseDataUrl(''), null);
            assert.strictEqual(parseDataUrl('data:image/png;base64,'), null);
        });

        test('should return null for non-base64 data URL', () => {
            const result = parseDataUrl('data:image/png,rawdata');
            assert.strictEqual(result, null);
        });

        test('should decode buffer content correctly', () => {
            const result = parseDataUrl(TINY_PNG_DATA_URL);
            assert.ok(result);
            // Re-encode and compare
            const reEncoded = result!.buffer.toString('base64');
            assert.strictEqual(reEncoded, TINY_PNG_BASE64);
        });
    });

    suite('saveImagesToTempFiles', () => {
        let createdTempDirs: string[] = [];

        teardown(() => {
            for (const dir of createdTempDirs) {
                try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
            }
            createdTempDirs = [];
        });

        test('should create temp directory and files for valid images', () => {
            const result = saveImagesToTempFiles([TINY_PNG_DATA_URL, TINY_GIF_DATA_URL]);
            createdTempDirs.push(result.tempDir);

            assert.ok(fs.existsSync(result.tempDir), 'Temp directory should exist');
            assert.strictEqual(result.filePaths.length, 2, 'Should create 2 files');

            // Check file extensions
            assert.ok(result.filePaths[0].endsWith('.png'), 'First file should be .png');
            assert.ok(result.filePaths[1].endsWith('.gif'), 'Second file should be .gif');

            // Check files exist and have content
            for (const fp of result.filePaths) {
                assert.ok(fs.existsSync(fp), `File should exist: ${fp}`);
                assert.ok(fs.statSync(fp).size > 0, `File should not be empty: ${fp}`);
            }
        });

        test('should skip invalid data URLs and only create valid ones', () => {
            const result = saveImagesToTempFiles([
                TINY_PNG_DATA_URL,
                'not-a-data-url',
                'data:text/plain;base64,SGVsbG8=',
                TINY_WEBP_DATA_URL
            ]);
            createdTempDirs.push(result.tempDir);

            assert.strictEqual(result.filePaths.length, 2, 'Should only create 2 valid files');
            assert.ok(result.filePaths[0].endsWith('.png'));
            assert.ok(result.filePaths[1].endsWith('.webp'));
        });

        test('should return empty filePaths when all images are invalid', () => {
            const result = saveImagesToTempFiles(['bad1', 'bad2']);
            createdTempDirs.push(result.tempDir);

            assert.ok(fs.existsSync(result.tempDir), 'Temp directory should still be created');
            assert.strictEqual(result.filePaths.length, 0);
        });

        test('should return empty filePaths for empty input', () => {
            const result = saveImagesToTempFiles([]);
            createdTempDirs.push(result.tempDir);

            assert.ok(fs.existsSync(result.tempDir), 'Temp directory should still be created');
            assert.strictEqual(result.filePaths.length, 0);
        });

        test('should normalise JPEG extension to jpg in file name', () => {
            const result = saveImagesToTempFiles([TINY_JPEG_DATA_URL]);
            createdTempDirs.push(result.tempDir);

            assert.strictEqual(result.filePaths.length, 1);
            assert.ok(result.filePaths[0].endsWith('.jpg'), 'Should use .jpg not .jpeg');
        });

        test('should write correct file content', () => {
            const result = saveImagesToTempFiles([TINY_PNG_DATA_URL]);
            createdTempDirs.push(result.tempDir);

            const content = fs.readFileSync(result.filePaths[0]);
            const expected = Buffer.from(TINY_PNG_BASE64, 'base64');
            assert.ok(content.equals(expected), 'File content should match decoded base64');
        });

        test('should create files in temp dir under os.tmpdir', () => {
            const result = saveImagesToTempFiles([TINY_PNG_DATA_URL]);
            createdTempDirs.push(result.tempDir);

            const normalized = (p: string) => p.replace(/\\/g, '/').toLowerCase();
            assert.ok(
                normalized(result.tempDir).startsWith(normalized(os.tmpdir())),
                'Temp dir should be under os.tmpdir()'
            );
        });

        test('should name files with sequential indices', () => {
            const result = saveImagesToTempFiles([TINY_PNG_DATA_URL, TINY_GIF_DATA_URL, TINY_WEBP_DATA_URL]);
            createdTempDirs.push(result.tempDir);

            assert.ok(path.basename(result.filePaths[0]).startsWith('image-0.'));
            assert.ok(path.basename(result.filePaths[1]).startsWith('image-1.'));
            assert.ok(path.basename(result.filePaths[2]).startsWith('image-2.'));
        });
    });

    suite('cleanupTempDir', () => {
        test('should remove directory and all contents', () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'));
            fs.writeFileSync(path.join(dir, 'file1.png'), 'data1');
            fs.writeFileSync(path.join(dir, 'file2.jpg'), 'data2');

            assert.ok(fs.existsSync(dir), 'Dir should exist before cleanup');

            cleanupTempDir(dir);

            assert.ok(!fs.existsSync(dir), 'Dir should not exist after cleanup');
        });

        test('should not throw for non-existent directory', () => {
            const nonExistent = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());
            // Should not throw
            cleanupTempDir(nonExistent);
        });

        test('should handle empty directory', () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-empty-'));
            cleanupTempDir(dir);
            assert.ok(!fs.existsSync(dir), 'Empty dir should be removed');
        });
    });
});
