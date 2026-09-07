import type { ServerResponse } from 'node:http';

export interface SseFrame {
    event?: string;
    data: string;
    id?: string;
}

/** Parse one block. Metadata and comments alone do not dispatch an event. */
export function parseSseBlock(block: string): SseFrame | null {
    let event: string | undefined;
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('id:')) id = line.slice(3).trim();
        // Preserve payload trailing whitespace; retain CoC's trimStart convention.
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    return data.length ? { event, data: data.join('\n'), id } : null;
}

/** Parse complete LF/CRLF frames, leaving the incomplete tail for the next chunk. */
export function parseSseBuffer(buffer: string): { frames: SseFrame[]; rest: string } {
    const blocks = buffer.split(/\r?\n\r?\n/);
    const rest = blocks.pop()!;
    const frames: SseFrame[] = [];
    for (const block of blocks) {
        const frame = parseSseBlock(block);
        if (frame) frames.push(frame);
    }
    return { frames, rest };
}

export const SSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
});

export function writeSseHeaders(res: ServerResponse, extra?: Record<string, string>): void {
    res.writeHead(200, { ...SSE_HEADERS, ...extra });
}

/** Success means written, independent of Node's backpressure signal. */
export function writeNamedEvent(res: ServerResponse, event: string, data: unknown): boolean {
    if (res.destroyed || res.writableEnded) return false;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
}

/** Wiki/data-only streams also tolerate a write racing with disconnection. */
export function writeDataEvent(res: ServerResponse, data: Record<string, unknown>): boolean {
    if (res.destroyed || res.writableEnded) return false;
    try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        return true;
    } catch {
        return false;
    }
}
