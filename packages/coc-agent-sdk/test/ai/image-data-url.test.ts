/**
 * Tests for tryConvertImageFileToDataUrl utility and the view-tool
 * image interception in CopilotSDKService streaming.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { tryConvertImageFileToDataUrl, tryReadImageAsBase64 } from '../../src/copilot-sdk-service';
import {
    isImageFilePath,
    isSupportedCodexImagePath,
    evaluateClaudeImageFile,
    sniffClaudeImageMediaType,
    sniffUnsupportedImageFormat,
    MAX_CLAUDE_IMAGE_BYTES,
} from '../../src/image-converter';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/copilot-sdk-service';
import { createStreamingMockSDKModule } from '../helpers/mock-sdk';



// ---------------------------------------------------------------------------
// tryConvertImageFileToDataUrl — unit tests
// ---------------------------------------------------------------------------

describe('tryConvertImageFileToDataUrl', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-test-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeTmpFile(name: string, content: Buffer | string): string {
        const p = path.join(tmpDir, name);
        fs.writeFileSync(p, content);
        return p;
    }

    it('should return a data URL for a valid PNG file', () => {
        // Minimal 1x1 red PNG
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
            'base64',
        );
        const filePath = writeTmpFile('test.png', png);
        const result = tryConvertImageFileToDataUrl(filePath);
        expect(result).not.toBeNull();
        expect(result).toMatch(/^data:image\/png;base64,/);
        // Re-decode the base64 portion and verify round-trip
        const b64 = result!.replace('data:image/png;base64,', '');
        expect(Buffer.from(b64, 'base64').equals(png)).toBe(true);
    });

    it('should return a data URL for a JPEG file (.jpg)', () => {
        const filePath = writeTmpFile('photo.jpg', Buffer.from([0xff, 0xd8, 0xff]));
        const result = tryConvertImageFileToDataUrl(filePath);
        expect(result).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('should return a data URL for a JPEG file (.jpeg)', () => {
        const filePath = writeTmpFile('photo.jpeg', Buffer.from([0xff, 0xd8, 0xff]));
        const result = tryConvertImageFileToDataUrl(filePath);
        expect(result).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('should return a data URL for a GIF file', () => {
        const filePath = writeTmpFile('anim.gif', Buffer.from('GIF89a'));
        const result = tryConvertImageFileToDataUrl(filePath);
        expect(result).toMatch(/^data:image\/gif;base64,/);
    });

    it('should return a data URL for a WebP file', () => {
        const filePath = writeTmpFile('image.webp', Buffer.from('RIFF'));
        const result = tryConvertImageFileToDataUrl(filePath);
        expect(result).toMatch(/^data:image\/webp;base64,/);
    });

    it('should return a data URL for an SVG file', () => {
        const filePath = writeTmpFile('icon.svg', '<svg></svg>');
        const result = tryConvertImageFileToDataUrl(filePath);
        expect(result).toMatch(/^data:image\/svg\+xml;base64,/);
    });

    it('should return null for a non-image file (.txt)', () => {
        const filePath = writeTmpFile('readme.txt', 'hello');
        expect(tryConvertImageFileToDataUrl(filePath)).toBeNull();
    });

    it('should return null for a non-image file (.ts)', () => {
        const filePath = writeTmpFile('code.ts', 'const x = 1;');
        expect(tryConvertImageFileToDataUrl(filePath)).toBeNull();
    });

    it('should return null for a non-existent file', () => {
        expect(tryConvertImageFileToDataUrl('/does/not/exist.png')).toBeNull();
    });

    it('should return null for a directory with an image extension', () => {
        const dirPath = path.join(tmpDir, 'fake.png');
        fs.mkdirSync(dirPath, { recursive: true });
        expect(tryConvertImageFileToDataUrl(dirPath)).toBeNull();
    });

    it('should be case-insensitive on the extension', () => {
        const filePath = writeTmpFile('PHOTO.PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const result = tryConvertImageFileToDataUrl(filePath);
        expect(result).toMatch(/^data:image\/png;base64,/);
    });
});

describe('image extension helpers', () => {
    it.each([
        ['test.png'],
        ['photo.jpg'],
        ['photo.jpeg'],
        ['anim.gif'],
        ['image.webp'],
        ['icon.svg'],
        ['PHOTO.PNG'],
    ])('recognizes image paths by extension: %s', (filePath) => {
        expect(isImageFilePath(filePath)).toBe(true);
    });

    it('does not recognize non-image paths as images', () => {
        expect(isImageFilePath('readme.txt')).toBe(false);
        expect(isImageFilePath('image')).toBe(false);
    });

    it('recognizes only Codex-supported raster image paths', () => {
        expect(isSupportedCodexImagePath('test.png')).toBe(true);
        expect(isSupportedCodexImagePath('photo.JPG')).toBe(true);
        expect(isSupportedCodexImagePath('image.webp')).toBe(true);
        expect(isSupportedCodexImagePath('icon.svg')).toBe(false);
        expect(isSupportedCodexImagePath('readme.txt')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Magic-byte image sniffing (content-based detection)
// ---------------------------------------------------------------------------

// Minimal byte buffers carrying each format's magic-number signature.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF_MAGIC = Buffer.from('GIF89a\x00\x00');
const WEBP_MAGIC = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
const HEIC_MAGIC = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
const AVIF_MAGIC = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
const BMP_MAGIC = Buffer.from([0x42, 0x4d, 0x00, 0x00]);
const TIFF_LE_MAGIC = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
const TIFF_BE_MAGIC = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]);
const ICO_MAGIC = Buffer.from([0x00, 0x00, 0x01, 0x00]);

describe('sniffClaudeImageMediaType', () => {
    it.each([
        ['PNG', PNG_MAGIC, 'image/png'],
        ['JPEG', JPEG_MAGIC, 'image/jpeg'],
        ['GIF', GIF_MAGIC, 'image/gif'],
        ['WebP', WEBP_MAGIC, 'image/webp'],
    ] as const)('detects %s from its magic bytes', (_label, bytes, mediaType) => {
        expect(sniffClaudeImageMediaType(bytes)).toBe(mediaType);
    });

    it('returns null for formats Claude cannot accept or non-image bytes', () => {
        expect(sniffClaudeImageMediaType(HEIC_MAGIC)).toBeNull();
        expect(sniffClaudeImageMediaType(BMP_MAGIC)).toBeNull();
        expect(sniffClaudeImageMediaType(Buffer.from('hello world'))).toBeNull();
        expect(sniffClaudeImageMediaType(Buffer.alloc(0))).toBeNull();
    });
});

describe('sniffUnsupportedImageFormat', () => {
    it.each([
        ['HEIC', HEIC_MAGIC, 'heic'],
        ['AVIF', AVIF_MAGIC, 'avif'],
        ['BMP', BMP_MAGIC, 'bmp'],
        ['TIFF little-endian', TIFF_LE_MAGIC, 'tiff'],
        ['TIFF big-endian', TIFF_BE_MAGIC, 'tiff'],
        ['ICO', ICO_MAGIC, 'ico'],
    ] as const)('labels %s as an unsupported image format', (_label, bytes, format) => {
        expect(sniffUnsupportedImageFormat(bytes)).toBe(format);
    });

    it('returns null for Claude-supported images and non-image bytes', () => {
        expect(sniffUnsupportedImageFormat(PNG_MAGIC)).toBeNull();
        expect(sniffUnsupportedImageFormat(JPEG_MAGIC)).toBeNull();
        expect(sniffUnsupportedImageFormat(Buffer.from('<svg></svg>'))).toBeNull();
        expect(sniffUnsupportedImageFormat(Buffer.from('plain text'))).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// tryReadImageAsBase64 — unit tests
// ---------------------------------------------------------------------------

describe('tryReadImageAsBase64', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-img-test-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeTmpFile(name: string, content: Buffer | string): string {
        const p = path.join(tmpDir, name);
        fs.writeFileSync(p, content);
        return p;
    }

    it.each([
        ['test.png', 'image/png'],
        ['photo.jpg', 'image/jpeg'],
        ['photo.jpeg', 'image/jpeg'],
        ['anim.gif', 'image/gif'],
        ['image.webp', 'image/webp'],
    ] as const)('returns a Claude image source for %s', (name, mediaType) => {
        const data = Buffer.from(`data:${name}`);
        const result = tryReadImageAsBase64(writeTmpFile(name, data));
        expect(result).toEqual({
            media_type: mediaType,
            data: data.toString('base64'),
        });
    });

    it('returns null for SVG because Claude base64 image blocks do not support it', () => {
        expect(tryReadImageAsBase64(writeTmpFile('icon.svg', '<svg></svg>'))).toBeNull();
    });

    it('returns null for unknown extensions and missing files', () => {
        expect(tryReadImageAsBase64(writeTmpFile('readme.txt', 'hello'))).toBeNull();
        expect(tryReadImageAsBase64(path.join(tmpDir, 'missing.png'))).toBeNull();
    });

    it('returns null for images larger than the conversion limit', () => {
        const filePath = writeTmpFile('large.png', Buffer.alloc(MAX_CLAUDE_IMAGE_BYTES + 1));
        expect(tryReadImageAsBase64(filePath)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// evaluateClaudeImageFile — explicit Claude image-size boundary
// ---------------------------------------------------------------------------

describe('evaluateClaudeImageFile', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-eval-test-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeTmpFile(name: string, content: Buffer | string): string {
        const p = path.join(tmpDir, name);
        fs.writeFileSync(p, content);
        return p;
    }

    it('returns null for unsupported extensions (SVG, text) — a silent, non-diagnostic skip', () => {
        expect(evaluateClaudeImageFile(writeTmpFile('icon.svg', '<svg></svg>'))).toBeNull();
        expect(evaluateClaudeImageFile(writeTmpFile('notes.txt', 'hello'))).toBeNull();
    });

    it('forwards an under-limit image with its metadata', () => {
        const bytes = Buffer.alloc(1024, 3);
        const result = evaluateClaudeImageFile(writeTmpFile('small.png', bytes));
        expect(result).toEqual({
            ok: true,
            source: { media_type: 'image/png', data: bytes.toString('base64') },
            byteSize: bytes.length,
            extension: 'png',
            mediaType: 'image/png',
        });
    });

    it('forwards an image whose byte size is exactly at the limit', () => {
        const bytes = Buffer.alloc(MAX_CLAUDE_IMAGE_BYTES, 5);
        const result = evaluateClaudeImageFile(writeTmpFile('exact.webp', bytes));
        expect(result?.ok).toBe(true);
        if (result?.ok) {
            expect(result.byteSize).toBe(MAX_CLAUDE_IMAGE_BYTES);
            expect(result.mediaType).toBe('image/webp');
        }
    });

    it('skips an over-limit image with a sanitized too-large diagnostic', () => {
        const oversized = MAX_CLAUDE_IMAGE_BYTES + 1;
        const result = evaluateClaudeImageFile(writeTmpFile('big.jpg', Buffer.alloc(oversized)));
        expect(result).toEqual({
            ok: false,
            skip: {
                reason: 'too-large',
                byteSize: oversized,
                limit: MAX_CLAUDE_IMAGE_BYTES,
                extension: 'jpg',
                mediaType: 'image/jpeg',
            },
        });
    });

    it('reports a read-error skip for a missing supported-extension file', () => {
        const result = evaluateClaudeImageFile(path.join(tmpDir, 'missing.png'));
        expect(result).toEqual({
            ok: false,
            skip: { reason: 'read-error', limit: MAX_CLAUDE_IMAGE_BYTES, extension: 'png', mediaType: 'image/png' },
        });
    });

    it('reports a not-a-regular-file skip for a directory with an image extension', () => {
        const dirPath = path.join(tmpDir, 'folder.png');
        fs.mkdirSync(dirPath, { recursive: true });
        const result = evaluateClaudeImageFile(dirPath);
        expect(result).toEqual({
            ok: false,
            skip: { reason: 'not-a-regular-file', limit: MAX_CLAUDE_IMAGE_BYTES, extension: 'png', mediaType: 'image/png' },
        });
    });

    it('forwards a real PNG whose filename has a non-image extension (content-first)', () => {
        // Regression: an image written to a temp file with a wrong extension
        // (e.g. a pasted screenshot that lost its suffix) must still be forwarded
        // — detection is by magic bytes, not the filename.
        const png = Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Buffer.from('png-body-bytes'),
        ]);
        const result = evaluateClaudeImageFile(writeTmpFile('screenshot.bin', png));
        expect(result?.ok).toBe(true);
        if (result?.ok) {
            expect(result.mediaType).toBe('image/png');
            expect(result.source.data).toBe(png.toString('base64'));
        }
    });

    it('forwards a real JPEG that has no extension at all (content-first)', () => {
        const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-body')]);
        const result = evaluateClaudeImageFile(writeTmpFile('pasted-image', jpeg));
        expect(result?.ok).toBe(true);
        if (result?.ok) expect(result.mediaType).toBe('image/jpeg');
    });

    it('records an unsupported-format skip for HEIC content instead of dropping it silently', () => {
        const heic = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
        const result = evaluateClaudeImageFile(writeTmpFile('photo.heic', heic));
        expect(result).toEqual({
            ok: false,
            skip: { reason: 'unsupported-format', limit: MAX_CLAUDE_IMAGE_BYTES, extension: 'heic', detectedFormat: 'heic' },
        });
    });

    it('records an unsupported-format skip for BMP content behind a misleading extension', () => {
        const bmp = Buffer.concat([Buffer.from([0x42, 0x4d]), Buffer.from('bmp-body')]);
        const result = evaluateClaudeImageFile(writeTmpFile('image.dat', bmp));
        expect(result).toEqual({
            ok: false,
            skip: { reason: 'unsupported-format', limit: MAX_CLAUDE_IMAGE_BYTES, extension: 'dat', detectedFormat: 'bmp' },
        });
    });
});

// ---------------------------------------------------------------------------
// Integration: view tool completion replaces result with data URL
// ---------------------------------------------------------------------------

vi.mock('../../src/trusted-folder', async () => {
    const actual = await vi.importActual('../../src/trusted-folder');
    return { ...actual, ensureFolderTrusted: vi.fn() };
});

vi.mock('../../src/mcp-config-loader', () => ({
    loadDefaultMcpConfig: vi.fn().mockReturnValue({
        success: false, fileExists: false, mcpServers: {},
    }),
    loadEffectiveMcpConfig: vi.fn().mockReturnValue({
        success: true, fileExists: false, configPath: '', mcpServers: {},
    }),
    mergeMcpConfigs: vi.fn().mockImplementation(
        (base: Record<string, any>, override?: Record<string, any>) => ({ ...base, ...override }),
    ),
}));

const createSdkClientMock = vi.fn();
vi.mock('../../src/sdk-client-factory', () => ({
    createSdkClient: (...args: any[]) => createSdkClientMock(...args),
}));

describe('CopilotSDKService - view tool image interception', () => {
    let service: CopilotSDKService;
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-img-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        service.dispose();
        resetCopilotSDKService();
    });

    function setupStreamingCall() {
        const { MockCopilotClient, sessions } = createStreamingMockSDKModule();
        const serviceAny = service as any;
        createSdkClientMock.mockImplementation((opts: any) => new MockCopilotClient(opts));
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const toolEvents: any[] = [];
        const resultPromise = service.sendMessage({
            prompt: 'Test prompt',
            workingDirectory: '/test',
            timeoutMs: 200000,
            loadDefaultMcpConfig: false,
            onToolEvent: (ev: any) => toolEvents.push(ev),
        });

        return { sessions, resultPromise, toolEvents };
    }

    it('should replace view tool result with data URL for image files', async () => {
        // Write a real PNG to disk
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
            'base64',
        );
        const imgPath = path.join(tmpDir, 'screenshot.png');
        fs.writeFileSync(imgPath, png);

        const { sessions, resultPromise, toolEvents } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'Here is the image', messageId: 'msg-1' } });
        dispatchEvent({
            type: 'tool.execution_start',
            data: { toolCallId: 'tc-img', toolName: 'view', arguments: { path: imgPath } },
        });
        dispatchEvent({
            type: 'tool.execution_complete',
            data: { toolCallId: 'tc-img', success: true, result: { content: 'Viewed image file successfully.' } },
        });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);

        // The captured tool call should have a data URL result
        const toolCall = result.toolCalls?.find((tc: any) => tc.id === 'tc-img');
        expect(toolCall).toBeDefined();
        expect(toolCall!.result).toMatch(/^data:image\/png;base64,/);

        // The onToolEvent emission should also have the data URL
        const completeEvent = toolEvents.find(
            (e: any) => e.type === 'tool-complete' && e.toolCallId === 'tc-img',
        );
        expect(completeEvent).toBeDefined();
        expect(completeEvent.result).toMatch(/^data:image\/png;base64,/);
    });

    it('should NOT replace view tool result for non-image files', async () => {
        const txtPath = path.join(tmpDir, 'readme.txt');
        fs.writeFileSync(txtPath, 'Hello world');

        const { sessions, resultPromise, toolEvents } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'File contents', messageId: 'msg-1' } });
        dispatchEvent({
            type: 'tool.execution_start',
            data: { toolCallId: 'tc-txt', toolName: 'view', arguments: { path: txtPath } },
        });
        dispatchEvent({
            type: 'tool.execution_complete',
            data: { toolCallId: 'tc-txt', success: true, result: { content: '1. Hello world' } },
        });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);

        const toolCall = result.toolCalls?.find((tc: any) => tc.id === 'tc-txt');
        expect(toolCall).toBeDefined();
        expect(toolCall!.result).toBe('1. Hello world');

        const completeEvent = toolEvents.find(
            (e: any) => e.type === 'tool-complete' && e.toolCallId === 'tc-txt',
        );
        expect(completeEvent.result).toBe('1. Hello world');
    });

    it('should NOT replace result for non-view tools even with image path args', async () => {
        const imgPath = path.join(tmpDir, 'other.png');
        fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50]));

        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'result', messageId: 'msg-1' } });
        dispatchEvent({
            type: 'tool.execution_start',
            data: { toolCallId: 'tc-grep', toolName: 'grep', arguments: { path: imgPath } },
        });
        dispatchEvent({
            type: 'tool.execution_complete',
            data: { toolCallId: 'tc-grep', success: true, result: { content: 'grep result' } },
        });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        const toolCall = result.toolCalls?.find((tc: any) => tc.id === 'tc-grep');
        expect(toolCall!.result).toBe('grep result');
    });

    it('should gracefully fall back when image file does not exist', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'result', messageId: 'msg-1' } });
        dispatchEvent({
            type: 'tool.execution_start',
            data: { toolCallId: 'tc-missing', toolName: 'view', arguments: { path: '/nonexistent/photo.png' } },
        });
        dispatchEvent({
            type: 'tool.execution_complete',
            data: { toolCallId: 'tc-missing', success: true, result: { content: 'Viewed image file successfully.' } },
        });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        const toolCall = result.toolCalls?.find((tc: any) => tc.id === 'tc-missing');
        // Falls back to original result text
        expect(toolCall!.result).toBe('Viewed image file successfully.');
    });
});
