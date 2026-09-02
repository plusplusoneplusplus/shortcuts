/**
 * Generation Event → SSE Mapping Tests
 *
 * The wiki admin UI parses these payloads, so the mapping must stay byte-for-byte
 * what the handler used to write inline. Undefined fields are omitted rather
 * than serialized as null.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ServerResponse } from 'http';
import { createSseEventSink, createRecordingEventSink, type GenerationEvent } from '../../../../src/server/wiki/generation';

function createMockResponse(opts?: { destroyed?: boolean; writableEnded?: boolean }): ServerResponse & { _chunks: string[] } {
    const chunks: string[] = [];
    return {
        _chunks: chunks,
        destroyed: opts?.destroyed ?? false,
        writableEnded: opts?.writableEnded ?? false,
        write: vi.fn((chunk: string) => { chunks.push(chunk); return true; }),
    } as unknown as ServerResponse & { _chunks: string[] };
}

describe('createSseEventSink', () => {
    it.each<[string, GenerationEvent, string]>([
        [
            'status',
            { type: 'status', phase: 1, state: 'running', message: 'Starting discovery...' },
            'data: {"type":"status","phase":1,"state":"running","message":"Starting discovery..."}\n\n',
        ],
        [
            'phase-complete',
            { type: 'phase-complete', phase: 1, success: true, duration: 42, message: 'Discovered 3 components' },
            'data: {"type":"phase-complete","phase":1,"success":true,"duration":42,"message":"Discovered 3 components"}\n\n',
        ],
        [
            'log with phase',
            { type: 'log', phase: 3, message: 'Loaded 2 cached analyses' },
            'data: {"type":"log","phase":3,"message":"Loaded 2 cached analyses"}\n\n',
        ],
        [
            'error with phase',
            { type: 'error', phase: 4, message: 'Writing failed (exit code 1)' },
            'data: {"type":"error","phase":4,"message":"Writing failed (exit code 1)"}\n\n',
        ],
        [
            'failing done',
            { type: 'done', success: false, error: 'Cancelled' },
            'data: {"type":"done","success":false,"error":"Cancelled"}\n\n',
        ],
        [
            'successful done',
            { type: 'done', success: true, duration: 100 },
            'data: {"type":"done","success":true,"duration":100}\n\n',
        ],
        [
            'component done',
            { type: 'done', success: true, componentId: 'auth', duration: 5, message: 'Article regenerated' },
            'data: {"type":"done","success":true,"componentId":"auth","duration":5,"message":"Article regenerated"}\n\n',
        ],
    ])('writes the %s event in the existing wire format', (_name, event, expected) => {
        const res = createMockResponse();

        expect(createSseEventSink(res)(event)).toBe(true);
        expect(res._chunks).toEqual([expected]);
    });

    it('omits fields that are undefined rather than emitting null', () => {
        const res = createMockResponse();

        createSseEventSink(res)({ type: 'log', phase: undefined, message: 'Wiki data reloaded' });

        expect(res._chunks[0]).toBe('data: {"type":"log","message":"Wiki data reloaded"}\n\n');
    });

    it('reports false once the client has disconnected', () => {
        const destroyed = createMockResponse({ destroyed: true });
        const ended = createMockResponse({ writableEnded: true });

        expect(createSseEventSink(destroyed)({ type: 'done', success: true })).toBe(false);
        expect(createSseEventSink(ended)({ type: 'done', success: true })).toBe(false);
        expect(destroyed._chunks).toEqual([]);
        expect(ended._chunks).toEqual([]);
    });
});

describe('createRecordingEventSink', () => {
    it('appends events in order and always accepts', () => {
        const events: GenerationEvent[] = [];
        const sink = createRecordingEventSink(events);

        expect(sink({ type: 'log', message: 'a' })).toBe(true);
        sink({ type: 'done', success: true });

        expect(events).toEqual([
            { type: 'log', message: 'a' },
            { type: 'done', success: true },
        ]);
    });
});
