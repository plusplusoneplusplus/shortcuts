import { PassThrough, Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadInboundImage, ImageDownloadError } from '../../src/core';

const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const options = { maxBytes: 100 };

afterEach(() => vi.useRealTimers());

describe('bounded incoming image downloads', () => {
    it.each([
        ['image/png', png],
        ['image/jpeg', Buffer.from('ffd8ffe000', 'hex')],
        ['image/gif', Buffer.from('GIF89a')],
        ['image/webp', Buffer.from('RIFF0000WEBP')],
    ])('accepts %s with matching bytes', async (mimeType, data) => {
        const stream = Readable.from([data.subarray(0, 3), data.subarray(3)]);
        expect(await downloadInboundImage(mimeType, async () => stream, { maxBytes: data.length })).toEqual(data);
        expect(stream.destroyed).toBe(true);
    });

    it.each(['image/svg+xml', 'image/heic', 'application/pdf', '', 'constructor', '__proto__'])
    ('rejects unsupported type %s before downloading', async mimeType => {
        const open = vi.fn();
        await expect(downloadInboundImage(mimeType, open, options)).rejects.toMatchObject({ code: 'unsupported' });
        expect(open).not.toHaveBeenCalled();
    });

    it.each([Buffer.alloc(0), Buffer.from('<html>not an image</html>'), Buffer.from('GIF87a')])
    ('rejects empty or mismatched content', async data => {
        await expect(downloadInboundImage('image/png', async () => Readable.from([data]), options))
            .rejects.toMatchObject({ code: 'unsupported' });
    });

    it('stops at the decoded byte limit even when a stream continues', async () => {
        const stream = new PassThrough();
        const result = downloadInboundImage('image/png', async () => stream, { maxBytes: png.length });
        const rejection = expect(result).rejects.toMatchObject({ code: 'size-limit' });
        stream.write(png);
        stream.write(Buffer.from('extra bytes'));
        await rejection;
        expect(stream.destroyed).toBe(true);
    });

    it('sanitizes acquisition and stream errors', async () => {
        const secret = new Error('https://media.example/?token=secret-token');
        await expect(downloadInboundImage('image/png', async () => { throw secret; }, options))
            .rejects.toEqual(new ImageDownloadError('download'));
        const stream = new PassThrough();
        const result = downloadInboundImage('image/png', async () => stream, options);
        const rejection = expect(result).rejects.toEqual(new ImageDownloadError('download'));
        await Promise.resolve();
        stream.destroy(secret);
        await rejection;
    });

    it.each(['caller', 'lifetime'])('cancels through the %s signal and closes the stream', async owner => {
        const controller = new AbortController();
        const stream = new PassThrough();
        let transportSignal: AbortSignal | undefined;
        const result = downloadInboundImage('image/png', async signal => {
            transportSignal = signal;
            return stream;
        }, { ...options, signal: owner === 'caller' ? controller.signal : undefined },
        owner === 'lifetime' ? controller.signal : undefined);
        const rejection = expect(result).rejects.toMatchObject({ code: 'cancelled' });
        await Promise.resolve();
        controller.abort(new Error('private cancellation details'));
        await rejection;
        expect(transportSignal?.aborted).toBe(true);
        expect(stream.destroyed).toBe(true);
    });

    it('does not open a stream for an already cancelled request', async () => {
        const controller = new AbortController();
        controller.abort();
        const open = vi.fn();
        await expect(downloadInboundImage('image/png', open, { ...options, signal: controller.signal }))
            .rejects.toMatchObject({ code: 'cancelled' });
        expect(open).not.toHaveBeenCalled();
    });

    it('times out stalled acquisition and destroys a stream returned late', async () => {
        vi.useFakeTimers();
        let complete!: (stream: Readable) => void;
        const result = downloadInboundImage('image/png', async () => new Promise(resolve => { complete = resolve; }),
            { ...options, timeoutMs: 50 });
        const rejection = expect(result).rejects.toMatchObject({ code: 'timeout' });
        await vi.advanceTimersByTimeAsync(50);
        await rejection;
        const stream = new PassThrough();
        complete(stream);
        await Promise.resolve();
        await Promise.resolve();
        expect(stream.destroyed).toBe(true);
    });

    it('caps the full streaming deadline at thirty seconds', async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        const result = downloadInboundImage('image/png', async () => stream, { ...options, timeoutMs: 60_000 });
        const rejection = expect(result).rejects.toMatchObject({ code: 'timeout' });
        await vi.advanceTimersByTimeAsync(30_000);
        await rejection;
        expect(stream.destroyed).toBe(true);
    });

    it.each([{ maxBytes: 0 }, { maxBytes: Infinity }, { maxBytes: 1.5 }, { maxBytes: 10, timeoutMs: 0 }])
    ('rejects invalid limits', async limits => {
        await expect(downloadInboundImage('image/png', vi.fn(), limits)).rejects.toThrow(RangeError);
    });
});
