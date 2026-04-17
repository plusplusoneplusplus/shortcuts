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
} from '../../src/server/attachment-utils';
import type { AttachmentPayload } from '../../src/server/attachment-utils';

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

    it('rejects files exceeding 10MB', () => {
        const { payloads } = validateAttachments([
            makePayload({ size: 11 * 1024 * 1024 }),
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
    it('saves a text file and returns its content', () => {
        const tempDir = makeTempDir();
        const { attachments, textContents } = saveAttachmentsToTempFiles([makePayload()], tempDir);

        expect(attachments).toHaveLength(1);
        expect(attachments[0].type).toBe('file');
        expect(fs.existsSync(attachments[0].path)).toBe(true);

        expect(textContents).toHaveLength(1);
        expect(textContents[0].name).toBe('test.txt');
        expect(textContents[0].content).toBe(TEXT_CONTENT);
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
});

// ── buildTextAttachmentContext ────────────────────────────────────────────

describe('buildTextAttachmentContext', () => {
    it('returns empty string for no text contents', () => {
        expect(buildTextAttachmentContext([])).toBe('');
    });

    it('wraps a single file in attached_file tags', () => {
        const ctx = buildTextAttachmentContext([{ name: 'readme.md', content: '# Hello' }]);
        expect(ctx).toContain('<attached_file name="readme.md">');
        expect(ctx).toContain('# Hello');
        expect(ctx).toContain('</attached_file>');
    });

    it('includes multiple files', () => {
        const ctx = buildTextAttachmentContext([
            { name: 'a.txt', content: 'AAA' },
            { name: 'b.txt', content: 'BBB' },
        ]);
        expect(ctx).toContain('a.txt');
        expect(ctx).toContain('b.txt');
    });

    it('truncates very long content', () => {
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
        expect(result.textContext).toContain('code.ts');
        expect(result.fileAttachmentMeta).toHaveLength(1);
        expect(result.fileAttachmentMeta![0].category).toBe('text');
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
});
