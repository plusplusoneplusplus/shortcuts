import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../src/sdk-esm-loader', () => ({
    dynamicImportModule: vi.fn(),
}));

import { ClaudeSDKService } from '../../src/claude-sdk-service';
import { dynamicImportModule } from '../../src/sdk-esm-loader';

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

    it('skips oversized image attachments', async () => {
        await svc.sendMessage({
            prompt: 'Too large',
            attachments: [
                { type: 'file', path: writeFile('large.png', Buffer.alloc((10 * 1024 * 1024) + 1)), displayName: 'large.png' },
            ],
        });

        expect(queryFn.mock.calls[0][0].prompt).toBe('Too large');
    });
});
