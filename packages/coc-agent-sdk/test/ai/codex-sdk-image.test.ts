import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodexSDKService } from '../../src/codex-sdk-service';
import type { Attachment } from '../../src/types';

function makeCodexMock() {
    const thread = {
        id: 'thread-1',
        runStreamed: vi.fn(async () => ({
            events: (async function* () {
                yield { type: 'thread.started' as const, thread_id: 'thread-1' };
                yield {
                    type: 'item.completed' as const,
                    item: { id: 'item-1', type: 'agent_message', text: 'ok' },
                };
            })(),
        })),
    };
    const client = {
        startThread: vi.fn(() => thread),
        resumeThread: vi.fn(() => thread),
    };
    return { client, thread };
}

async function sendWithAttachments(prompt: string, attachments?: Attachment[]) {
    const svc = new CodexSDKService();
    const { client, thread } = makeCodexMock();
    (svc as unknown as { sdk: unknown }).sdk = client;
    (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

    try {
        const result = await svc.sendMessage({ prompt, attachments });
        expect(result.success).toBe(true);
        return thread.runStreamed.mock.calls[0][0];
    } finally {
        svc.dispose();
    }
}

function fileAttachment(filePath: string): Attachment {
    return { type: 'file', path: filePath, displayName: filePath };
}

describe('CodexSDKService image attachments', () => {
    it('forwards supported image attachments as local_image input', async () => {
        const imagePath = '/tmp/screenshot.png';

        await expect(sendWithAttachments('describe this', [fileAttachment(imagePath)]))
            .resolves.toEqual([
                { type: 'text', text: 'describe this' },
                { type: 'local_image', path: imagePath },
            ]);
    });

    it('preserves string input when no image attachments are present', async () => {
        await expect(sendWithAttachments('plain prompt')).resolves.toBe('plain prompt');
    });

    it('skips directories, non-images, and SVG attachments', async () => {
        await expect(sendWithAttachments('plain prompt', [
            { type: 'directory', path: '/tmp/images', displayName: 'images' },
            fileAttachment('/tmp/readme.txt'),
            fileAttachment('/tmp/icon.svg'),
        ])).resolves.toBe('plain prompt');
    });

    it('forwards multiple image attachments in order', async () => {
        await expect(sendWithAttachments('compare', [
            fileAttachment('/tmp/first.jpg'),
            fileAttachment('/tmp/notes.md'),
            fileAttachment('/tmp/second.WEBP'),
        ])).resolves.toEqual([
            { type: 'text', text: 'compare' },
            { type: 'local_image', path: '/tmp/first.jpg' },
            { type: 'local_image', path: '/tmp/second.WEBP' },
        ]);
    });
});


describe('Codex WSL image delivery', () => {
    it.each([undefined, 'existing-thread'])('delivers host upload bytes with session %s', async sessionId => {
        const svc = new CodexSDKService();
        const { client, thread } = makeCodexMock();
        (svc as any).sdk = client;
        (svc as any).availabilityCache = { available: true };
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-wsl-image-'));
        const image = path.join(dir, 'upload.png');
        const bytes = Buffer.from('image bytes');
        fs.writeFileSync(image, bytes);
        try {
            const result = await svc.sendMessage({
                prompt: 'look', sessionId, workingDirectory: String.raw`\\wsl$\Ubuntu\home\a\repo`,
                attachments: [fileAttachment(image)],
            });
            expect(result.success).toBe(true);
            const input = thread.runStreamed.mock.calls[0][0];
            expect(input).toEqual([{ type: 'text', text: 'look' }, { type: 'local_image', path: image }]);
            expect(fs.readFileSync(input[1].path)).toEqual(bytes);
            expect(sessionId ? client.resumeThread : client.startThread).toHaveBeenCalledWith(
                ...(sessionId ? [sessionId] : []), expect.objectContaining({ workingDirectory: String.raw`\\wsl$\Ubuntu\home\a\repo` }),
            );
            fs.rmSync(image);
            const failed = await svc.sendMessage({
                prompt: 'look', sessionId, workingDirectory: String.raw`\\wsl$\Ubuntu\repo`,
                attachments: [fileAttachment(image)],
            });
            expect(failed.success).toBe(false);
            expect(failed.error).toContain('Cannot read WSL image attachment');
            expect(thread.runStreamed).toHaveBeenCalledTimes(1);
            expect(fs.readdirSync(dir)).toEqual([]);
        } finally {
            svc.dispose();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
