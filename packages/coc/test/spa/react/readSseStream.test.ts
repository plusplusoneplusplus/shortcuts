import { describe, expect, it, vi } from 'vitest';
import { readSseStream } from '../../../src/server/spa/client/react/utils/readSseStream';

function stream(chunks: Uint8Array[]) {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
        },
    });
}

describe('readSseStream', () => {
    it('decodes multiline frames and UTF-8 across every byte boundary', async () => {
        const bytes = new TextEncoder().encode(':ok\r\n\r\nevent: chunk\r\nid: 1\r\ndata: {"content":\r\ndata: "你好 😀"}\r\n\r\ndata: {"type":"done"}\n\n');
        const body = stream(Array.from(bytes, byte => Uint8Array.of(byte)));
        const frames = [];
        for await (const frame of readSseStream(body)) frames.push(frame);
        expect(frames).toEqual([
            { event: 'chunk', id: '1', data: '{"content":\n"你好 😀"}' },
            { event: undefined, id: undefined, data: '{"type":"done"}' },
        ]);
        expect(body.locked).toBe(false);
    });

    it.each([true, false])('flushes an unterminated final frame only when requested (%s)', async flushFinalFrame => {
        const body = stream([new TextEncoder().encode('data: {"type":"done"}')]);
        const frames = [];
        for await (const frame of readSseStream(body, { flushFinalFrame })) frames.push(frame);
        expect(frames).toHaveLength(flushFinalFrame ? 1 : 0);
        expect(body.locked).toBe(false);
    });

    it('cancels the reader and releases its lock when the consumer stops early', async () => {
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new TextEncoder().encode('data: {}\n\n')); },
            cancel,
        });
        for await (const _frame of readSseStream(body)) break;
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(body.locked).toBe(false);
    });

    it('propagates abort/read failures and releases the lock', async () => {
        const error = new DOMException('Aborted', 'AbortError');
        const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(error); } });
        await expect(readSseStream(body).next()).rejects.toBe(error);
        expect(body.locked).toBe(false);
    });
});
