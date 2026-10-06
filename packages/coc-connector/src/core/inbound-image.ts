import type { Readable } from 'node:stream';

export interface ImageDownloadOptions {
    /** The consumer's attachment byte limit, enforced on decoded bytes. */
    maxBytes: number;
    signal?: AbortSignal;
    /** Defaults to 30 seconds; shorter deadlines may be supplied. */
    timeoutMs?: number;
}

/** A lazy, transport-authenticated image; download only after inbound admission. */
export interface InboundImage {
    /** Authenticated response MIME; transports may resolve it during download. */
    mimeType: string;
    download(options: ImageDownloadOptions): Promise<Buffer>;
}

export type ImageDownloadErrorCode = 'unsupported' | 'size-limit' | 'timeout' | 'cancelled' | 'download';

/** Safe to show to users: never includes provider bodies, URLs or credentials. */
export class ImageDownloadError extends Error {
    constructor(readonly code: ImageDownloadErrorCode) {
        const messages: Record<ImageDownloadErrorCode, string> = {
            unsupported: 'Unsupported image. Send a PNG, JPEG, GIF or WebP image.',
            'size-limit': 'Image is too large. Send a smaller image.',
            timeout: 'Image download timed out. Send the image again.',
            cancelled: 'Image download was cancelled. Send the image again.',
            download: 'Could not download the image. Send the image again.',
        };
        super(messages[code]);
        this.name = 'ImageDownloadError';
    }
}

const IMAGE_SIGNATURES: Record<string, (data: Buffer) => boolean> = {
    'image/png': data => data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/jpeg': data => data[0] === 255 && data[1] === 216 && data[2] === 255,
    'image/gif': data => ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii')),
    'image/webp': data => data.subarray(0, 4).toString('ascii') === 'RIFF'
        && data.subarray(8, 12).toString('ascii') === 'WEBP',
};

/** Bound acquisition and streaming together, including transports that stall before returning a stream. */
export async function downloadInboundImage(
    mimeType: string | (() => string),
    openStream: (signal: AbortSignal) => Promise<Readable>,
    options: ImageDownloadOptions,
    lifetimeSignal?: AbortSignal,
): Promise<Buffer> {
    const timeoutMs = Math.min(options.timeoutMs ?? 30_000, 30_000);
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0
        || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        throw new RangeError('Invalid image download limits');
    }
    if (typeof mimeType === 'string' && !Object.hasOwn(IMAGE_SIGNATURES, mimeType)) {
        throw new ImageDownloadError('unsupported');
    }

    const controller = new AbortController();
    const cancel = () => controller.abort(new ImageDownloadError('cancelled'));
    const signals = [options.signal, lifetimeSignal].filter((s): s is AbortSignal => !!s);
    for (const signal of signals) {
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
    }
    const timer = setTimeout(() => controller.abort(new ImageDownloadError('timeout')), timeoutMs);
    let stream: Readable | undefined;
    let onAbort: () => void = () => {};
    try {
        controller.signal.throwIfAborted();
        const interrupted = new Promise<never>((_, reject) => {
            onAbort = () => { stream?.destroy(); reject(controller.signal.reason); };
            controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        const download = (async () => {
            stream = await openStream(controller.signal);
            if (controller.signal.aborted) {
                stream.destroy();
                controller.signal.throwIfAborted();
            }
            const resolvedMime = typeof mimeType === 'string' ? mimeType : mimeType();
            if (!Object.hasOwn(IMAGE_SIGNATURES, resolvedMime)) throw new ImageDownloadError('unsupported');
            const checkSignature = IMAGE_SIGNATURES[resolvedMime];
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of stream) {
                controller.signal.throwIfAborted();
                const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                size += data.length;
                if (size > options.maxBytes) throw new ImageDownloadError('size-limit');
                chunks.push(data);
            }
            controller.signal.throwIfAborted();
            const data = Buffer.concat(chunks, size);
            if (!checkSignature(data)) throw new ImageDownloadError('unsupported');
            return data;
        })();
        return await Promise.race([download, interrupted]);
    } catch (error) {
        if (error instanceof ImageDownloadError) throw error;
        throw new ImageDownloadError('download');
    } finally {
        clearTimeout(timer);
        for (const signal of signals) signal.removeEventListener('abort', cancel);
        controller.signal.removeEventListener('abort', onAbort);
        stream?.destroy();
        controller.abort();
    }
}
