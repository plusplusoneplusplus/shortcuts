/**
 * New-Chat Attachments — Regression Test
 *
 * Verifies that the very first message of a brand-new chat (POST /api/queue
 * with `payload.attachments` in wire AttachmentPayload format) decodes the
 * attachments server-side so the executor and the initial-turn renderer both
 * see the right shapes:
 *
 *   - payload.attachments is rewritten to SDK Attachment[] (file-path refs)
 *   - payload.images carries the data URLs (for the user-turn bubble)
 *   - payload.imageTempDir carries the temp dir (for executor cleanup)
 *   - payload.fileAttachmentMeta carries per-attachment display meta
 *   - text-file content is appended to payload.prompt
 *
 * Bug: prior to the fix, payload.attachments flowed through validateAndParseTask
 * unchanged, and chat-base-executor.execute() only read payload.images. Pasted
 * screenshots / files on a brand-new chat were silently dropped.
 */

import fs from 'fs';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { decodeChatPayloadAttachments } from '../../src/server/routes/queue-enqueue';

// 1×1 transparent PNG data URL — small but valid image payload.
const TINY_PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// "hello world" base64-encoded as a text/plain data URL (small enough to be inlined).
const SHORT_TEXT_DATA_URL = 'data:text/plain;base64,aGVsbG8gd29ybGQ=';

// A long text data URL that exceeds the externalize threshold (200 chars).
const LONG_TEXT_PLAIN = 'A'.repeat(500);
const LONG_TEXT_DATA_URL = `data:text/plain;base64,${Buffer.from(LONG_TEXT_PLAIN).toString('base64')}`;

describe('decodeChatPayloadAttachments', () => {
    const tempDirsToCleanup: string[] = [];

    afterEach(() => {
        for (const dir of tempDirsToCleanup) {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
        }
        tempDirsToCleanup.length = 0;
        vi.restoreAllMocks();
    });

    it('decodes a wire-format image attachment into SDK form + sets images/imageTempDir/meta', () => {
        const payload: Record<string, unknown> = {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'look at this',
            attachments: [
                {
                    name: 'screenshot.png',
                    mimeType: 'image/png',
                    size: 95,
                    dataUrl: TINY_PNG_DATA_URL,
                },
            ],
        };

        decodeChatPayloadAttachments(payload);

        // attachments rewritten to SDK file-path form
        expect(Array.isArray(payload.attachments)).toBe(true);
        const attachments = payload.attachments as Array<Record<string, unknown>>;
        expect(attachments).toHaveLength(1);
        expect(attachments[0].type).toBe('file');
        expect(typeof attachments[0].path).toBe('string');
        expect(fs.existsSync(attachments[0].path as string)).toBe(true);

        // images preserved as data URLs (for initial-turn rendering)
        expect(payload.images).toEqual([TINY_PNG_DATA_URL]);

        // imageTempDir set (so the executor's finally block cleans it)
        expect(typeof payload.imageTempDir).toBe('string');
        expect(fs.existsSync(payload.imageTempDir as string)).toBe(true);
        tempDirsToCleanup.push(payload.imageTempDir as string);

        // fileAttachmentMeta describes the attachment
        expect(payload.fileAttachmentMeta).toEqual([
            { name: 'screenshot.png', mimeType: 'image/png', size: 95, category: 'image' },
        ]);

        // prompt is unchanged for image-only attachments (no text context)
        expect(payload.prompt).toBe('look at this');
    });

    it('appends short text-file attachment content to the prompt', () => {
        const payload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'review this file',
            attachments: [
                {
                    name: 'note.txt',
                    mimeType: 'text/plain',
                    size: 11,
                    dataUrl: SHORT_TEXT_DATA_URL,
                },
            ],
        };

        decodeChatPayloadAttachments(payload);

        expect(typeof payload.prompt).toBe('string');
        const prompt = payload.prompt as string;
        expect(prompt.startsWith('review this file')).toBe(true);
        expect(prompt).toContain('<attached_file name="note.txt"');
        expect(prompt).toContain('hello world');

        // Image fields are NOT set for non-image attachments.
        expect(payload.images).toBeUndefined();

        // SDK attachment + temp dir still produced.
        const attachments = payload.attachments as Array<Record<string, unknown>>;
        expect(attachments).toHaveLength(1);
        expect(attachments[0].type).toBe('file');
        expect(typeof payload.imageTempDir).toBe('string');
        tempDirsToCleanup.push(payload.imageTempDir as string);
    });

    it('externalizes large text-file attachments (file-path reference, not inlined)', () => {
        const payload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'see attached',
            attachments: [
                {
                    name: 'big.txt',
                    mimeType: 'text/plain',
                    size: LONG_TEXT_PLAIN.length,
                    dataUrl: LONG_TEXT_DATA_URL,
                },
            ],
        };

        decodeChatPayloadAttachments(payload);

        const prompt = payload.prompt as string;
        expect(prompt).toContain('<attached_file name="big.txt"');
        expect(prompt).toContain('path="');
        // Long content must NOT be inlined.
        expect(prompt).not.toContain(LONG_TEXT_PLAIN);
        tempDirsToCleanup.push(payload.imageTempDir as string);
    });

    it('is a no-op when payload.kind is not chat', () => {
        const payload: Record<string, unknown> = {
            kind: 'run-script',
            script: 'echo hi',
            attachments: [
                {
                    name: 'screenshot.png',
                    mimeType: 'image/png',
                    size: 95,
                    dataUrl: TINY_PNG_DATA_URL,
                },
            ],
        };

        decodeChatPayloadAttachments(payload);

        // attachments untouched, no temp dir created.
        expect(payload.imageTempDir).toBeUndefined();
        expect(payload.images).toBeUndefined();
        expect((payload.attachments as Array<Record<string, unknown>>)[0].dataUrl).toBe(TINY_PNG_DATA_URL);
    });

    it('is a no-op when attachments is already SDK form (idempotent)', () => {
        const fakeSdkAttachment = { type: 'file' as const, path: '/tmp/already-saved.png', displayName: 'already-saved.png' };
        const payload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'hi',
            attachments: [fakeSdkAttachment],
        };

        decodeChatPayloadAttachments(payload);

        // attachments are not the wire format — left as-is.
        expect(payload.attachments).toEqual([fakeSdkAttachment]);
        expect(payload.imageTempDir).toBeUndefined();
        expect(payload.images).toBeUndefined();
    });

    it('is a no-op when there are no attachments', () => {
        const payload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'plain text only',
        };

        decodeChatPayloadAttachments(payload);

        expect(payload.attachments).toBeUndefined();
        expect(payload.imageTempDir).toBeUndefined();
        expect(payload.images).toBeUndefined();
        expect(payload.prompt).toBe('plain text only');
    });

    it('unsets attachments without allocating a temp dir when none of the wire entries are valid', () => {
        const mkdtempSpy = vi.spyOn(fs, 'mkdtempSync');
        const payload: Record<string, unknown> = {
            kind: 'chat',
            prompt: 'hi',
            attachments: [
                {
                    // Missing required `name` field — validator should reject.
                    mimeType: 'image/png',
                    size: 10,
                    dataUrl: TINY_PNG_DATA_URL,
                },
            ],
        };

        decodeChatPayloadAttachments(payload);

        expect(payload.attachments).toBeUndefined();
        expect(payload.imageTempDir).toBeUndefined();
        expect(mkdtempSpy).not.toHaveBeenCalled();
    });
});
