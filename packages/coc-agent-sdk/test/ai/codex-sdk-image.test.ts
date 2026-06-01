import { describe, expect, it, vi } from 'vitest';
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
