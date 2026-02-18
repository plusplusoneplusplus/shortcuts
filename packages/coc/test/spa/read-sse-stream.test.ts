/**
 * Tests for readSSEStream helper function.
 */

import { describe, it, expect, vi } from 'vitest';
import { readSSEStream } from '../../src/server/wiki/spa/client/sse-utils';

function createMockReader(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
    const encoder = new TextEncoder();
    let index = 0;
    return {
        read: vi.fn(async () => {
            if (index >= chunks.length) {
                return { done: true, value: undefined } as ReadableStreamReadDoneResult;
            }
            const value = encoder.encode(chunks[index++]);
            return { done: false, value } as ReadableStreamReadValueResult<Uint8Array>;
        }),
        releaseLock: vi.fn(),
        cancel: vi.fn(),
        closed: Promise.resolve(undefined),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

describe('readSSEStream', () => {
    it('parses a single SSE event', async () => {
        const events: any[] = [];
        const reader = createMockReader([
            'data: {"type":"status","message":"hello"}\n\n'
        ]);

        await readSSEStream(reader, (event) => events.push(event));

        expect(events).toEqual([{ type: 'status', message: 'hello' }]);
    });

    it('parses multiple SSE events in one chunk', async () => {
        const events: any[] = [];
        const reader = createMockReader([
            'data: {"type":"log","message":"a"}\ndata: {"type":"log","message":"b"}\n'
        ]);

        await readSSEStream(reader, (event) => events.push(event));

        expect(events).toHaveLength(2);
        expect(events[0].message).toBe('a');
        expect(events[1].message).toBe('b');
    });

    it('handles events split across chunks', async () => {
        const events: any[] = [];
        const reader = createMockReader([
            'data: {"type":"st',
            'atus","message":"split"}\n'
        ]);

        await readSSEStream(reader, (event) => events.push(event));

        expect(events).toEqual([{ type: 'status', message: 'split' }]);
    });

    it('ignores lines that do not start with "data: "', async () => {
        const events: any[] = [];
        const reader = createMockReader([
            'event: something\ndata: {"type":"ok"}\nid: 123\n'
        ]);

        await readSSEStream(reader, (event) => events.push(event));

        expect(events).toEqual([{ type: 'ok' }]);
    });

    it('ignores malformed JSON in data lines', async () => {
        const events: any[] = [];
        const reader = createMockReader([
            'data: not-json\ndata: {"type":"valid"}\n'
        ]);

        await readSSEStream(reader, (event) => events.push(event));

        expect(events).toEqual([{ type: 'valid' }]);
    });

    it('handles empty stream', async () => {
        const events: any[] = [];
        const reader = createMockReader([]);

        await readSSEStream(reader, (event) => events.push(event));

        expect(events).toHaveLength(0);
    });

    it('handles done event with seeds', async () => {
        const events: any[] = [];
        const seeds = [{ theme: 'Testing', description: 'A test theme', hints: ['hint1'] }];
        const reader = createMockReader([
            'data: {"type":"done","success":true,"seeds":' + JSON.stringify(seeds) + '}\n'
        ]);

        await readSSEStream(reader, (event) => events.push(event));

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('done');
        expect(events[0].success).toBe(true);
        expect(events[0].seeds).toEqual(seeds);
    });

    it('handles multiple chunks with trailing buffer', async () => {
        const events: any[] = [];
        const reader = createMockReader([
            'data: {"type":"a"}\ndata: {"ty',
            'pe":"b"}\ndata: {"type":"c"}\n'
        ]);

        await readSSEStream(reader, (event) => events.push(event));

        expect(events).toHaveLength(3);
        expect(events.map((e: any) => e.type)).toEqual(['a', 'b', 'c']);
    });
});
