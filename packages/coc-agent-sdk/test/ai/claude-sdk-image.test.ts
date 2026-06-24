import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../src/sdk-esm-loader', () => ({
    dynamicImportModule: vi.fn(),
}));

import { ClaudeSDKService } from '../../src/claude-sdk-service';
import { dynamicImportModule } from '../../src/sdk-esm-loader';
import { MAX_CLAUDE_IMAGE_BYTES } from '../../src/image-converter';
import { initSDKLogger, resetSDKLogger } from '../../src/logger';

const mockDynamicImport = vi.mocked(dynamicImportModule);

const SUCCESS = { type: 'result', subtype: 'success', result: 'ok', session_id: 's1' };

function makeHandle(messages: object[]) {
    return {
        [Symbol.asyncIterator]() {
            return (async function* () { for (const message of messages) yield message; })();
        },
        accountInfo: vi.fn(async () => ({})),
        return: vi.fn(async () => ({ done: true as const, value: undefined })),
    };
}

async function drainAsyncIterable(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
    const values: unknown[] = [];
    for await (const value of iterable) values.push(value);
    return values;
}

/** Minimal pino-shaped logger that records every call for assertions. */
function createCapturingLogger() {
    const logs: Array<{ level: string; fields: Record<string, unknown>; message: string }> = [];
    const capture = (level: string) => (...args: unknown[]) => {
        const [first, second] = args;
        const fields = typeof first === 'object' && first !== null && !Array.isArray(first)
            ? (first as Record<string, unknown>)
            : {};
        const message = typeof first === 'string' ? first : typeof second === 'string' ? second : '';
        logs.push({ level, fields, message });
    };
    const logger: Record<string, unknown> = {
        debug: capture('debug'),
        info: capture('info'),
        warn: capture('warn'),
        error: capture('error'),
    };
    logger.child = () => logger;
    return { logs, logger };
}

describe('ClaudeSDKService image attachments', () => {
    let svc: ClaudeSDKService;
    let tmpDir: string;
    const queryFn = vi.fn();

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-sdk-image-'));
        queryFn.mockReset();
        queryFn.mockReturnValue(makeHandle([SUCCESS]));
        mockDynamicImport.mockReset();
        mockDynamicImport.mockResolvedValue({ query: queryFn });
        svc = new ClaudeSDKService();
    });

    afterEach(() => {
        svc.dispose();
        resetSDKLogger();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeFile(name: string, content: Buffer | string): string {
        const filePath = path.join(tmpDir, name);
        fs.writeFileSync(filePath, content);
        return filePath;
    }

    it('forwards supported image attachments as Claude base64 image blocks', async () => {
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
            'base64',
        );

        const result = await svc.sendMessage({
            prompt: 'Describe this image',
            attachments: [{ type: 'file', path: writeFile('screenshot.png', png), displayName: 'screenshot.png' }],
        });

        expect(result.success).toBe(true);
        const prompt = queryFn.mock.calls[0][0].prompt;
        expect(typeof prompt).not.toBe('string');
        const messages = await drainAsyncIterable(prompt);
        expect(messages).toEqual([
            {
                type: 'user',
                message: {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Describe this image' },
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: 'image/png',
                                data: png.toString('base64'),
                            },
                        },
                    ],
                },
                parent_tool_use_id: null,
            },
        ]);
    });

    it('keeps a plain string prompt when no attachments are provided', async () => {
        await svc.sendMessage({ prompt: 'Text only' });

        expect(queryFn.mock.calls[0][0].prompt).toBe('Text only');
    });

    it('skips unsupported image and non-image attachments', async () => {
        await svc.sendMessage({
            prompt: 'Skip unsupported',
            attachments: [
                { type: 'file', path: writeFile('icon.svg', '<svg></svg>'), displayName: 'icon.svg' },
                { type: 'file', path: writeFile('notes.txt', 'hello'), displayName: 'notes.txt' },
                { type: 'directory', path: tmpDir, displayName: 'directory' },
            ],
        });

        expect(queryFn.mock.calls[0][0].prompt).toBe('Skip unsupported');
    });

    it('forwards an image whose byte size is exactly at the limit', async () => {
        // A buffer exactly at MAX_CLAUDE_IMAGE_BYTES must still be forwarded —
        // the boundary check skips only strictly-greater sizes.
        const exact = Buffer.alloc(MAX_CLAUDE_IMAGE_BYTES, 1);
        const result = await svc.sendMessage({
            prompt: 'Exactly at limit',
            attachments: [{ type: 'file', path: writeFile('exact.png', exact), displayName: 'exact.png' }],
        });

        expect(result.success).toBe(true);
        const prompt = queryFn.mock.calls[0][0].prompt;
        expect(typeof prompt).not.toBe('string');
        const messages = (await drainAsyncIterable(prompt)) as Array<{
            message: { content: Array<{ type: string; source?: { media_type: string } }> };
        }>;
        const blocks = messages[0].message.content;
        expect(blocks).toHaveLength(2);
        expect(blocks[1].type).toBe('image');
        expect(blocks[1].source?.media_type).toBe('image/png');
    });

    it('skips oversized image attachments and keeps the text prompt', async () => {
        await svc.sendMessage({
            prompt: 'Too large',
            attachments: [
                { type: 'file', path: writeFile('large.png', Buffer.alloc(MAX_CLAUDE_IMAGE_BYTES + 1)), displayName: 'large.png' },
            ],
        });

        // Oversized image dropped; request still runs as a plain text prompt.
        expect(queryFn.mock.calls[0][0].prompt).toBe('Too large');
    });

    it('records a sanitized skip diagnostic for an oversized image (no payload/prompt leak)', async () => {
        const { logs, logger } = createCapturingLogger();
        initSDKLogger(logger as never);

        const oversizedBytes = MAX_CLAUDE_IMAGE_BYTES + 1024;
        await svc.sendMessage({
            prompt: 'Sensitive prompt text that must never be logged',
            attachments: [
                { type: 'file', path: writeFile('huge.png', Buffer.alloc(oversizedBytes, 7)), displayName: 'huge.png' },
            ],
        });

        const skip = logs.find(l => l.fields.event === 'claude_image_skipped');
        expect(skip).toBeDefined();
        expect(skip!.level).toBe('warn');
        expect(skip!.fields.reason).toBe('too-large');
        expect(skip!.fields.byteSize).toBe(oversizedBytes);
        expect(skip!.fields.limitBytes).toBe(MAX_CLAUDE_IMAGE_BYTES);
        expect(skip!.fields.extension).toBe('png');
        expect(skip!.fields.mediaType).toBe('image/png');
        expect(skip!.fields.attachmentName).toBe('huge.png');

        // The diagnostic must never carry image bytes or prompt text.
        const serialized = JSON.stringify(skip);
        expect(serialized).not.toContain('Sensitive prompt text');
        expect(serialized).not.toContain(Buffer.alloc(8, 7).toString('base64'));
    });

    it('falls back to the path basename when an oversized image has no display name', async () => {
        const { logs, logger } = createCapturingLogger();
        initSDKLogger(logger as never);

        await svc.sendMessage({
            prompt: 'No display name',
            attachments: [
                { type: 'file', path: writeFile('unnamed.png', Buffer.alloc(MAX_CLAUDE_IMAGE_BYTES + 1)), displayName: '' },
            ],
        });

        const skip = logs.find(l => l.fields.event === 'claude_image_skipped');
        expect(skip).toBeDefined();
        expect(skip!.fields.attachmentName).toBe('unnamed.png');
    });

    it('forwards a real PNG attachment whose temp filename lost its image extension', async () => {
        // Regression: a pasted/uploaded image can land on disk with a non-image
        // extension (or none). Detection is content-based, so it must still be
        // forwarded as a base64 image block rather than silently dropped.
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
            'base64',
        );

        const result = await svc.sendMessage({
            prompt: 'Describe this image',
            attachments: [{ type: 'file', path: writeFile('screenshot.bin', png), displayName: 'screenshot.png' }],
        });

        expect(result.success).toBe(true);
        const prompt = queryFn.mock.calls[0][0].prompt;
        expect(typeof prompt).not.toBe('string');
        const messages = (await drainAsyncIterable(prompt)) as Array<{
            message: { content: Array<{ type: string; source?: { media_type: string; data: string } }> };
        }>;
        const imageBlock = messages[0].message.content.find(b => b.type === 'image');
        expect(imageBlock).toBeDefined();
        expect(imageBlock!.source?.media_type).toBe('image/png');
        expect(imageBlock!.source?.data).toBe(png.toString('base64'));
    });

    it('logs an unsupported-format skip for a HEIC attachment and keeps the text prompt', async () => {
        const { logs, logger } = createCapturingLogger();
        initSDKLogger(logger as never);

        const heic = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
        await svc.sendMessage({
            prompt: 'Look at this photo',
            attachments: [{ type: 'file', path: writeFile('photo.heic', heic), displayName: 'photo.heic' }],
        });

        // No Claude-supported image → request still runs as a plain text prompt.
        expect(queryFn.mock.calls[0][0].prompt).toBe('Look at this photo');

        const skip = logs.find(l => l.fields.event === 'claude_image_skipped');
        expect(skip).toBeDefined();
        expect(skip!.fields.reason).toBe('unsupported-format');
        expect(skip!.fields.detectedFormat).toBe('heic');
        expect(skip!.fields.extension).toBe('heic');
        expect(skip!.fields.attachmentName).toBe('photo.heic');
    });
});
