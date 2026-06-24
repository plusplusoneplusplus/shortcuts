/**
 * Attachment Utilities Tests
 *
 * Unit tests for validateAttachments, saveAttachmentsToTempFiles,
 * buildTextAttachmentContext, parseGenericDataUrl, and processMessageAttachments.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    parseGenericDataUrl,
    validateAttachments,
    saveAttachmentsToTempFiles,
    buildTextAttachmentContext,
    hasAttachments,
    processMessageAttachments,
    TEXT_EXTERNALIZE_THRESHOLD,
    MAX_ATTACHMENT_SIZE,
} from '../../src/server/core/attachment-utils';
import type { AttachmentPayload } from '../../src/server/core/attachment-utils';

// Track temp dirs for cleanup
const tempDirs: string[] = [];

function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-attachment-test-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tempDirs.length = 0;
});

// ── Helpers ──────────────────────────────────────────────────────────────

// 1x1 red PNG pixel, base64-encoded
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_1X1}`;

const TEXT_CONTENT = 'Hello, world!';
const TEXT_B64 = Buffer.from(TEXT_CONTENT).toString('base64');
const TEXT_DATA_URL = `data:text/plain;base64,${TEXT_B64}`;

const JSON_CONTENT = '{"key": "value"}';
const JSON_B64 = Buffer.from(JSON_CONTENT).toString('base64');
const JSON_DATA_URL = `data:application/json;base64,${JSON_B64}`;

function makePayload(overrides: Partial<AttachmentPayload> = {}): AttachmentPayload {
    return {
        name: 'test.txt',
        mimeType: 'text/plain',
        size: TEXT_CONTENT.length,
        dataUrl: TEXT_DATA_URL,
        ...overrides,
    };
}

/**
 * Build an image/png data URL whose *decoded* bytes exceed MAX_ATTACHMENT_SIZE.
 * Used for forged-size tests: the declared `size` on the payload can be set
 * arbitrarily small while the actual decoded image bytes are over the limit.
 */
function makeOversizedImageDataUrl(): string {
    const oversized = Buffer.alloc(MAX_ATTACHMENT_SIZE + 1);
    return `data:image/png;base64,${oversized.toString('base64')}`;
}

// ── parseGenericDataUrl ──────────────────────────────────────────────────

describe('parseGenericDataUrl', () => {
    it('parses a text/plain data URL', () => {
        const result = parseGenericDataUrl(TEXT_DATA_URL);
        expect(result).not.toBeNull();
        expect(result!.mimeType).toBe('text/plain');
        expect(result!.buffer.toString('utf-8')).toBe(TEXT_CONTENT);
    });

    it('parses an image/png data URL', () => {
        const result = parseGenericDataUrl(PNG_DATA_URL);
        expect(result).not.toBeNull();
        expect(result!.mimeType).toBe('image/png');
        expect(result!.buffer.length).toBeGreaterThan(0);
    });

    it('parses a JSON data URL', () => {
        const result = parseGenericDataUrl(JSON_DATA_URL);
        expect(result).not.toBeNull();
        expect(result!.mimeType).toBe('application/json');
        expect(result!.buffer.toString('utf-8')).toBe(JSON_CONTENT);
    });

    it('returns null for empty string', () => {
        expect(parseGenericDataUrl('')).toBeNull();
    });

    it('returns null for invalid data URL', () => {
        expect(parseGenericDataUrl('not-a-data-url')).toBeNull();
    });

    it('returns null for data URL without base64 prefix', () => {
        expect(parseGenericDataUrl('data:text/plain;utf8,hello')).toBeNull();
    });
});

// ── validateAttachments ──────────────────────────────────────────────────

describe('validateAttachments', () => {
    it('validates a single text attachment', () => {
        const { payloads, meta } = validateAttachments([makePayload()]);
        expect(payloads).toHaveLength(1);
        expect(meta).toHaveLength(1);
        expect(meta[0].category).toBe('text');
        expect(meta[0].name).toBe('test.txt');
    });

    it('validates an image attachment', () => {
        const { payloads, meta } = validateAttachments([
            makePayload({ name: 'photo.png', mimeType: 'image/png', dataUrl: PNG_DATA_URL }),
        ]);
        expect(payloads).toHaveLength(1);
        expect(meta[0].category).toBe('image');
    });

    it('classifies binary files correctly', () => {
        const { meta } = validateAttachments([
            makePayload({ name: 'data.zip', mimeType: 'application/zip' }),
        ]);
        expect(meta[0].category).toBe('binary');
    });

    it('rejects objects missing required fields', () => {
        const { payloads } = validateAttachments([
            { mimeType: 'text/plain', size: 10 }, // missing name and dataUrl
            { name: 'ok.txt', dataUrl: TEXT_DATA_URL, size: 10 }, // valid
        ]);
        expect(payloads).toHaveLength(1);
        expect(payloads[0].name).toBe('ok.txt');
    });

    it('rejects files whose declared size exceeds the limit', () => {
        const { payloads } = validateAttachments([
            makePayload({ size: MAX_ATTACHMENT_SIZE + 1 }),
        ]);
        expect(payloads).toHaveLength(0);
    });

    it('caps at 10 attachments', () => {
        const items = Array.from({ length: 15 }, (_, i) =>
            makePayload({ name: `file${i}.txt` })
        );
        const { payloads } = validateAttachments(items);
        expect(payloads).toHaveLength(10);
    });

    it('skips null and non-object items', () => {
        const { payloads } = validateAttachments([null, undefined, 'string', 42, makePayload()] as any[]);
        expect(payloads).toHaveLength(1);
    });
});

// ── saveAttachmentsToTempFiles ───────────────────────────────────────────

describe('saveAttachmentsToTempFiles', () => {
    it('saves a text file and returns its content with file path', () => {
        const tempDir = makeTempDir();
        const { attachments, textContents } = saveAttachmentsToTempFiles([makePayload()], tempDir);

        expect(attachments).toHaveLength(1);
        expect(attachments[0].type).toBe('file');
        expect(fs.existsSync(attachments[0].path)).toBe(true);
        expect(attachments[0].displayName).toBe('test.txt');

        expect(textContents).toHaveLength(1);
        expect(textContents[0].name).toBe('test.txt');
        expect(textContents[0].content).toBe(TEXT_CONTENT);
        expect(textContents[0].filePath).toBe(attachments[0].path);
    });

    it('saves an image file without text content', () => {
        const tempDir = makeTempDir();
        const { attachments, textContents } = saveAttachmentsToTempFiles(
            [makePayload({ name: 'photo.png', mimeType: 'image/png', dataUrl: PNG_DATA_URL })],
            tempDir,
        );

        expect(attachments).toHaveLength(1);
        expect(textContents).toHaveLength(0);
        expect(fs.existsSync(attachments[0].path)).toBe(true);
        expect(attachments[0].displayName).toBe('photo.png');
    });

    it('uses the original payload name as the display name for binary files', () => {
        const tempDir = makeTempDir();
        const binaryContent = Buffer.from([0, 1, 2, 3]);
        const { attachments, textContents } = saveAttachmentsToTempFiles(
            [makePayload({
                name: 'archive.zip',
                mimeType: 'application/zip',
                size: binaryContent.length,
                dataUrl: `data:application/zip;base64,${binaryContent.toString('base64')}`,
            })],
            tempDir,
        );

        expect(attachments).toHaveLength(1);
        expect(textContents).toHaveLength(0);
        expect(attachments[0].displayName).toBe('archive.zip');
    });

    it('falls back to the saved file basename when the payload name is blank', () => {
        const tempDir = makeTempDir();
        const { attachments } = saveAttachmentsToTempFiles(
            [makePayload({ name: '   ', mimeType: 'application/octet-stream' })],
            tempDir,
        );

        expect(attachments).toHaveLength(1);
        expect(path.basename(attachments[0].path)).toBe('file-0');
        expect(attachments[0].displayName).toBe('file-0');
    });

    it('saves a JSON file as text', () => {
        const tempDir = makeTempDir();
        const { textContents } = saveAttachmentsToTempFiles(
            [makePayload({ name: 'config.json', mimeType: 'application/json', dataUrl: JSON_DATA_URL, size: JSON_CONTENT.length })],
            tempDir,
        );

        expect(textContents).toHaveLength(1);
        expect(textContents[0].content).toBe(JSON_CONTENT);
    });

    it('handles mixed file types', () => {
        const tempDir = makeTempDir();
        const { attachments, textContents } = saveAttachmentsToTempFiles(
            [
                makePayload({ name: 'readme.txt' }),
                makePayload({ name: 'photo.png', mimeType: 'image/png', dataUrl: PNG_DATA_URL }),
            ],
            tempDir,
        );

        expect(attachments).toHaveLength(2);
        expect(textContents).toHaveLength(1);
        expect(textContents[0].name).toBe('readme.txt');
    });

    it('skips invalid data URLs', () => {
        const tempDir = makeTempDir();
        const { attachments } = saveAttachmentsToTempFiles(
            [makePayload({ dataUrl: 'not-a-data-url' })],
            tempDir,
        );
        expect(attachments).toHaveLength(0);
    });

    it('drops a forged-size image whose decoded bytes exceed the limit (never written to disk)', () => {
        const tempDir = makeTempDir();
        // Declared size is tiny, but the decoded image is over MAX_ATTACHMENT_SIZE.
        const forged = makePayload({
            name: 'forged.png',
            mimeType: 'image/png',
            size: 1024,
            dataUrl: makeOversizedImageDataUrl(),
        });
        const { attachments, textContents } = saveAttachmentsToTempFiles([forged], tempDir);

        expect(attachments).toHaveLength(0);
        expect(textContents).toHaveLength(0);
        // Nothing was written to disk for the oversized payload.
        expect(fs.readdirSync(tempDir)).toHaveLength(0);
    });

    it('drops a forged-size generic attachment whose decoded bytes exceed the limit', () => {
        const tempDir = makeTempDir();
        const oversized = Buffer.alloc(MAX_ATTACHMENT_SIZE + 1);
        const forged = makePayload({
            name: 'forged.bin',
            mimeType: 'application/octet-stream',
            size: 512,
            dataUrl: `data:application/octet-stream;base64,${oversized.toString('base64')}`,
        });
        const { attachments } = saveAttachmentsToTempFiles([forged], tempDir);

        expect(attachments).toHaveLength(0);
        expect(fs.readdirSync(tempDir)).toHaveLength(0);
    });

    it('still saves an image whose decoded bytes are within the limit', () => {
        const tempDir = makeTempDir();
        const { attachments } = saveAttachmentsToTempFiles(
            [makePayload({ name: 'photo.png', mimeType: 'image/png', dataUrl: PNG_DATA_URL })],
            tempDir,
        );
        expect(attachments).toHaveLength(1);
        expect(fs.existsSync(attachments[0].path)).toBe(true);
    });

    it('normalizes an image temp filename to match its MIME when the name has no extension', () => {
        const tempDir = makeTempDir();
        const { attachments } = saveAttachmentsToTempFiles(
            [makePayload({ name: 'screenshot', mimeType: 'image/png', dataUrl: PNG_DATA_URL })],
            tempDir,
        );

        expect(attachments).toHaveLength(1);
        // Regression: the on-disk file must carry a real .png extension so
        // extension-based providers (Claude, Codex) recognize it...
        expect(path.extname(attachments[0].path).toLowerCase()).toBe('.png');
        // ...while the user-facing display name keeps the original filename.
        expect(attachments[0].displayName).toBe('screenshot');
    });

    it('rewrites a wrong image extension to match the decoded MIME type', () => {
        const tempDir = makeTempDir();
        const { attachments } = saveAttachmentsToTempFiles(
            [makePayload({ name: 'photo.bin', mimeType: 'image/png', dataUrl: PNG_DATA_URL })],
            tempDir,
        );

        expect(path.extname(attachments[0].path).toLowerCase()).toBe('.png');
        expect(attachments[0].displayName).toBe('photo.bin');
    });

    it('uses image-<n>.<ext> on disk when an image payload name is blank', () => {
        const tempDir = makeTempDir();
        const { attachments } = saveAttachmentsToTempFiles(
            [makePayload({ name: '   ', mimeType: 'image/png', dataUrl: PNG_DATA_URL })],
            tempDir,
        );

        expect(path.basename(attachments[0].path)).toBe('image-0.png');
    });

    it('preserves a correct image extension (including jpg/jpeg equivalence)', () => {
        const tempDir = makeTempDir();
        const jpegDataUrl = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64')}`;
        const { attachments } = saveAttachmentsToTempFiles(
            [makePayload({ name: 'photo.jpeg', mimeType: 'image/jpeg', dataUrl: jpegDataUrl })],
            tempDir,
        );

        // 'jpeg' is already a valid JPEG extension and must not be rewritten to '.jpg'.
        expect(path.basename(attachments[0].path)).toBe('photo.jpeg');
    });
});

// ── buildTextAttachmentContext ────────────────────────────────────────────

describe('buildTextAttachmentContext', () => {
    it('returns empty string for no text contents', () => {
        expect(buildTextAttachmentContext([])).toBe('');
    });

    it('inlines small text in attached_file tags', () => {
        const shortContent = 'Hello';
        expect(shortContent.length).toBeLessThanOrEqual(TEXT_EXTERNALIZE_THRESHOLD);
        const ctx = buildTextAttachmentContext([{ name: 'readme.md', content: shortContent }]);
        expect(ctx).toContain('<attached_file name="readme.md">');
        expect(ctx).toContain(shortContent);
        expect(ctx).toContain('</attached_file>');
        expect(ctx).not.toContain('Read it at the path above');
    });

    it('inlines text exactly at threshold', () => {
        const exactContent = 'x'.repeat(TEXT_EXTERNALIZE_THRESHOLD);
        const ctx = buildTextAttachmentContext([{ name: 'exact.txt', content: exactContent, filePath: '/tmp/exact.txt' }]);
        expect(ctx).toContain(exactContent);
        expect(ctx).not.toContain('Read it at the path above');
    });

    it('externalizes text exceeding threshold when filePath is provided', () => {
        const largeContent = 'x'.repeat(TEXT_EXTERNALIZE_THRESHOLD + 1);
        const ctx = buildTextAttachmentContext([
            { name: 'big.txt', content: largeContent, filePath: '/tmp/big.txt' },
        ]);
        expect(ctx).toContain('<attached_file name="big.txt" path="/tmp/big.txt">');
        expect(ctx).toContain(`approximately ${largeContent.length} characters`);
        expect(ctx).toContain('Read it at the path above');
        expect(ctx).not.toContain(largeContent);
    });

    it('inlines large text when filePath is not provided (backward compat)', () => {
        const largeContent = 'x'.repeat(TEXT_EXTERNALIZE_THRESHOLD + 100);
        const ctx = buildTextAttachmentContext([{ name: 'big.txt', content: largeContent }]);
        expect(ctx).toContain(largeContent);
        expect(ctx).not.toContain('Read it at the path above');
    });

    it('handles mix of small and large text attachments', () => {
        const small = 'short';
        const large = 'y'.repeat(TEXT_EXTERNALIZE_THRESHOLD + 50);
        const ctx = buildTextAttachmentContext([
            { name: 'small.txt', content: small },
            { name: 'large.txt', content: large, filePath: '/tmp/large.txt' },
        ]);
        // Small file is inlined
        expect(ctx).toContain(small);
        // Large file is externalized
        expect(ctx).toContain('path="/tmp/large.txt"');
        expect(ctx).toContain('Read it at the path above');
        expect(ctx).not.toContain(large);
    });

    it('includes multiple files', () => {
        const ctx = buildTextAttachmentContext([
            { name: 'a.txt', content: 'AAA' },
            { name: 'b.txt', content: 'BBB' },
        ]);
        expect(ctx).toContain('a.txt');
        expect(ctx).toContain('b.txt');
    });

    it('truncates very long content when inlined (no filePath)', () => {
        const longContent = 'x'.repeat(60_000);
        const ctx = buildTextAttachmentContext([{ name: 'big.txt', content: longContent }]);
        expect(ctx).toContain('... (truncated)');
        expect(ctx.length).toBeLessThan(longContent.length);
    });
});

// ── hasAttachments ───────────────────────────────────────────────────────

describe('hasAttachments', () => {
    it('returns true when attachments array has items', () => {
        expect(hasAttachments({ attachments: [makePayload()] })).toBe(true);
    });

    it('returns false when attachments is empty', () => {
        expect(hasAttachments({ attachments: [] })).toBe(false);
    });

    it('returns false when attachments is missing', () => {
        expect(hasAttachments({})).toBe(false);
    });

    it('returns false when attachments is not an array', () => {
        expect(hasAttachments({ attachments: 'not-array' })).toBe(false);
    });
});

// ── processMessageAttachments ────────────────────────────────────────────

describe('processMessageAttachments', () => {
    it('processes new-style attachments', () => {
        const tempDir = makeTempDir();
        const body = {
            content: 'test',
            attachments: [makePayload({ name: 'code.ts', mimeType: 'text/typescript' })],
        };

        const result = processMessageAttachments(body, tempDir);
        expect(result.sdkAttachments.length).toBeGreaterThan(0);
        expect(result.sdkAttachments[0].displayName).toBe('code.ts');
        expect(result.textContext).toContain('code.ts');
        expect(result.fileAttachmentMeta).toHaveLength(1);
        expect(result.fileAttachmentMeta![0].category).toBe('text');
    });

    it('externalizes large text attachment content to file-path reference', () => {
        const tempDir = makeTempDir();
        const largeContent = 'z'.repeat(TEXT_EXTERNALIZE_THRESHOLD + 100);
        const largeB64 = Buffer.from(largeContent).toString('base64');
        const body = {
            content: 'analyze this',
            attachments: [makePayload({
                name: 'big-log.txt',
                mimeType: 'text/plain',
                size: largeContent.length,
                dataUrl: `data:text/plain;base64,${largeB64}`,
            })],
        };

        const result = processMessageAttachments(body, tempDir);
        // Text context should contain a file-path reference, not the inline content
        expect(result.textContext).toContain('Read it at the path above');
        expect(result.textContext).toContain(`approximately ${largeContent.length} characters`);
        expect(result.textContext).not.toContain(largeContent);
        // The file should still be saved as an SDK attachment
        expect(result.sdkAttachments.length).toBeGreaterThan(0);
    });

    it('inlines small text attachment content', () => {
        const tempDir = makeTempDir();
        const body = {
            content: 'test',
            attachments: [makePayload({ name: 'small.txt' })],
        };

        const result = processMessageAttachments(body, tempDir);
        // Small content should be inlined
        expect(result.textContext).toContain(TEXT_CONTENT);
        expect(result.textContext).not.toContain('Read it at the path above');
    });

    it('processes legacy images when no attachments provided', () => {
        const tempDir = makeTempDir();
        const body = {
            content: 'test',
            images: [PNG_DATA_URL],
        };

        const result = processMessageAttachments(body, tempDir);
        expect(result.validatedImages).toHaveLength(1);
        expect(result.sdkAttachments.length).toBeGreaterThan(0);
        expect(result.sdkAttachments[0].displayName).toBe(path.basename(result.sdkAttachments[0].path));
    });

    it('extracts image data URLs from new-style attachments for backward compat', () => {
        const tempDir = makeTempDir();
        const body = {
            content: 'test',
            attachments: [makePayload({ name: 'photo.png', mimeType: 'image/png', dataUrl: PNG_DATA_URL })],
        };

        const result = processMessageAttachments(body, tempDir);
        expect(result.validatedImages).toHaveLength(1);
        expect(result.validatedImages![0]).toBe(PNG_DATA_URL);
    });

    it('returns empty results when no images or attachments', () => {
        const tempDir = makeTempDir();
        const body = { content: 'test' };

        const result = processMessageAttachments(body, tempDir);
        expect(result.sdkAttachments).toHaveLength(0);
        expect(result.textContext).toBe('');
        expect(result.validatedImages).toBeUndefined();
        expect(result.fileAttachmentMeta).toBeUndefined();
    });

    it('drops a forged-size oversized image attachment safely (no temp file, no SDK attachment)', () => {
        const tempDir = makeTempDir();
        const body = {
            content: 'check this image',
            // Declared size is small, but decoded bytes exceed MAX_ATTACHMENT_SIZE.
            attachments: [makePayload({
                name: 'forged.png',
                mimeType: 'image/png',
                size: 512,
                dataUrl: makeOversizedImageDataUrl(),
            })],
        };

        const result = processMessageAttachments(body, tempDir);
        // The oversized image must not become an SDK attachment or a temp file…
        expect(result.sdkAttachments).toHaveLength(0);
        expect(fs.readdirSync(tempDir)).toHaveLength(0);
        // …and the request does not throw — the text prompt path still proceeds.
        expect(result.textContext).toBe('');
    });

    it('saves bitmap/image attachments to temp files (never inlined)', () => {
        const tempDir = makeTempDir();
        const body = {
            content: 'check this image',
            attachments: [makePayload({ name: 'screenshot.png', mimeType: 'image/png', dataUrl: PNG_DATA_URL })],
        };

        const result = processMessageAttachments(body, tempDir);
        // Image should be saved as SDK attachment with a file path
        expect(result.sdkAttachments).toHaveLength(1);
        expect(result.sdkAttachments[0].type).toBe('file');
        expect(fs.existsSync(result.sdkAttachments[0].path)).toBe(true);
        expect(result.sdkAttachments[0].displayName).toBe('screenshot.png');
        // Image content should NOT appear in text context
        expect(result.textContext).toBe('');
    });
});

// ── TEXT_EXTERNALIZE_THRESHOLD ───────────────────────────────────────────

describe('TEXT_EXTERNALIZE_THRESHOLD', () => {
    it('is 200', () => {
        expect(TEXT_EXTERNALIZE_THRESHOLD).toBe(200);
    });
});
