import { parseSseBlock, parseSseBuffer, type SseFrame } from '@plusplusoneplusplus/forge/sse';

/** Decode a fetch body without losing frames or UTF-8 characters across reads. */
export async function* readSseStream(
    body: ReadableStream<Uint8Array>,
    { flushFinalFrame = false }: { flushFinalFrame?: boolean } = {},
): AsyncGenerator<SseFrame> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    try {
        while (!finished) {
            const { done, value } = await reader.read();
            finished = done;
            const { frames, rest } = parseSseBuffer(buffer + decoder.decode(value, { stream: !done }));
            buffer = rest;
            yield* frames;
        }
        if (flushFinalFrame) {
            const frame = parseSseBlock(buffer);
            if (frame) yield frame;
        }
    } finally {
        // An early return (e.g. wiki done/error) must close the underlying fetch.
        try {
            if (!finished) await reader.cancel();
        } catch { /* Preserve the original read/consumer error. */ }
        reader.releaseLock();
    }
}
