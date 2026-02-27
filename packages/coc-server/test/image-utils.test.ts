/**
 * Image Utilities Tests
 *
 * Unit tests for parseDataUrl, saveImagesToTempFiles, and cleanupTempDir.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseDataUrl, saveImagesToTempFiles, cleanupTempDir } from '../src/image-utils';

// ============================================================================
// Helpers
// ============================================================================

// 1x1 red PNG pixel, base64-encoded
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_1X1}`;

// 1x1 red JPEG pixel, base64-encoded (minimal valid JPEG)
const JPEG_1X1 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA//9k=';
const JPEG_DATA_URL = `data:image/jpeg;base64,${JPEG_1X1}`;

// Track temp dirs for cleanup
const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tempDirs.length = 0;
});

// ============================================================================
// parseDataUrl
// ============================================================================

describe('parseDataUrl', () => {
    it('should parse a valid PNG data URL', () => {
        const result = parseDataUrl(PNG_DATA_URL);
        expect(result).not.toBeNull();
        expect(result!.mimeType).toBe('image/png');
        expect(result!.extension).toBe('png');
        expect(result!.buffer).toBeInstanceOf(Buffer);
        expect(result!.buffer.length).toBeGreaterThan(0);
    });

    it('should normalize jpeg extension to jpg', () => {
        const result = parseDataUrl(JPEG_DATA_URL);
        expect(result).not.toBeNull();
        expect(result!.mimeType).toBe('image/jpeg');
        expect(result!.extension).toBe('jpg');
        expect(result!.buffer).toBeInstanceOf(Buffer);
    });

    it('should return null for non-image data URL', () => {
        const textDataUrl = 'data:text/plain;base64,SGVsbG8=';
        expect(parseDataUrl(textDataUrl)).toBeNull();
    });

    it('should return null for empty string', () => {
        expect(parseDataUrl('')).toBeNull();
    });

    it('should return null for malformed data URL', () => {
        expect(parseDataUrl('not-a-data-url')).toBeNull();
    });

    it('should return null for data URL without base64 prefix', () => {
        expect(parseDataUrl('data:image/png;utf8,hello')).toBeNull();
    });
});

// ============================================================================
// saveImagesToTempFiles
// ============================================================================

describe('saveImagesToTempFiles', () => {
    it('should create temp files for two valid images', () => {
        const result = saveImagesToTempFiles([PNG_DATA_URL, JPEG_DATA_URL]);
        tempDirs.push(result.tempDir);

        expect(fs.existsSync(result.tempDir)).toBe(true);
        expect(result.attachments).toHaveLength(2);

        for (const att of result.attachments) {
            expect(att.type).toBe('file');
            expect(fs.existsSync(att.path)).toBe(true);
        }

        // Verify file names match expected pattern
        expect(path.basename(result.attachments[0].path)).toBe('image-0.png');
        expect(path.basename(result.attachments[1].path)).toBe('image-1.jpg');
    });

    it('should skip invalid images in a mix of valid and invalid', () => {
        const result = saveImagesToTempFiles([PNG_DATA_URL, 'invalid', JPEG_DATA_URL, '']);
        tempDirs.push(result.tempDir);

        expect(result.attachments).toHaveLength(2);
        // First valid is index 0 (png), second valid is index 2 (jpeg)
        expect(path.basename(result.attachments[0].path)).toBe('image-0.png');
        expect(path.basename(result.attachments[1].path)).toBe('image-2.jpg');
    });

    it('should return empty attachments for all-invalid images', () => {
        const result = saveImagesToTempFiles(['invalid', 'also-invalid', '']);
        tempDirs.push(result.tempDir);

        expect(result.attachments).toHaveLength(0);
        // Temp dir should still exist (caller responsible for cleanup)
        expect(fs.existsSync(result.tempDir)).toBe(true);
    });

    it('should handle single valid image', () => {
        const result = saveImagesToTempFiles([PNG_DATA_URL]);
        tempDirs.push(result.tempDir);

        expect(result.attachments).toHaveLength(1);
        expect(result.attachments[0].type).toBe('file');
        expect(fs.existsSync(result.attachments[0].path)).toBe(true);
    });
});

// ============================================================================
// cleanupTempDir
// ============================================================================

describe('cleanupTempDir', () => {
    it('should remove a directory and its contents', () => {
        const result = saveImagesToTempFiles([PNG_DATA_URL]);
        const dir = result.tempDir;
        expect(fs.existsSync(dir)).toBe(true);

        cleanupTempDir(dir);
        expect(fs.existsSync(dir)).toBe(false);
    });

    it('should not throw for a non-existent path', () => {
        expect(() => cleanupTempDir('/tmp/does-not-exist-12345')).not.toThrow();
    });
});
