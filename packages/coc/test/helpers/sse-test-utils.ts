import { parseSseBuffer } from '@plusplusoneplusplus/forge/sse';

/** Decode JSON payloads from the complete frames captured by a response. */
export function parseSSEFrames(chunks: string[]): Array<{ event: string; data: any }> {
    return parseSseBuffer(chunks.join('')).frames
        .filter(frame => frame.data)
        .map(frame => ({ event: frame.event ?? '', data: JSON.parse(frame.data) }));
}
