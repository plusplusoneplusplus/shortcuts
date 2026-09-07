import { describe, expect, it, vi } from 'vitest';
import type { ServerResponse } from 'node:http';
import { parseSseBlock, parseSseBuffer, SSE_HEADERS, writeSseHeaders, writeNamedEvent, writeDataEvent } from '../src/sse';

describe('SSE frames', () => {
    it('joins data lines and preserves trailing whitespace', () => {
        expect(parseSseBlock('event: chunk\nid: 42\n:ok\nretry: 100\ndata:  \tfirst  \ndata: second\ndata:'))
            .toEqual({ event: 'chunk', id: '42', data: 'first  \nsecond\n' });
    });

    it('keeps empty data and unnamed events, ignoring blocks without data', () => {
        expect(parseSseBlock('data:')).toEqual({ data: '', event: undefined, id: undefined });
        expect(parseSseBlock('data: {}')?.data).toBe('{}');
        expect(parseSseBlock(':ok\nevent: ignored\nid: 1\nretry: 100')).toBeNull();
        expect(parseSseBlock('')).toBeNull();
    });

    it.each(['\n', '\r\n'])('retains a partial frame and handles split delimiters (%j)', newline => {
        const wire = ['event: chunk', 'data: {"content":"hello"}', '', 'data: {}', '', ''].join(newline);
        for (let split = 0; split <= wire.length; split++) {
            const first = parseSseBuffer(wire.slice(0, split));
            const second = parseSseBuffer(first.rest + wire.slice(split));
            expect([...first.frames, ...second.frames].map(f => f.data)).toEqual(['{"content":"hello"}', '{}']);
            expect(second.rest).toBe('');
        }
        expect(parseSseBuffer(`:ok${newline}${newline}data: partial`)).toEqual({ frames: [], rest: 'data: partial' });
    });
});

describe('SSE writers', () => {
    function response(overrides = {}) {
        return { writeHead: vi.fn(), write: vi.fn(() => false), ...overrides } as unknown as ServerResponse;
    }

    it('sets shared headers with per-endpoint overrides', () => {
        const res = response();
        writeSseHeaders(res, { 'Cache-Control': 'no-store', 'X-Test': 'yes' });
        expect(res.writeHead).toHaveBeenCalledWith(200, { ...SSE_HEADERS, 'Cache-Control': 'no-store', 'X-Test': 'yes' });
        expect(SSE_HEADERS['Cache-Control']).toBe('no-cache');
    });

    it('preserves both JSON wire formats and does not treat backpressure as failure', () => {
        const res = response();
        const payload = { type: 'chunk', content: 'a\nb 😀' };
        expect(writeNamedEvent(res, 'chunk', payload)).toBe(true);
        expect(writeDataEvent(res, payload)).toBe(true);
        expect(res.write).toHaveBeenNthCalledWith(1, `event: chunk\ndata: ${JSON.stringify(payload)}\n\n`);
        expect(res.write).toHaveBeenNthCalledWith(2, `data: ${JSON.stringify(payload)}\n\n`);
    });

    it.each([{ destroyed: true }, { writableEnded: true }])('guards closed responses: %j', state => {
        const res = response(state);
        expect(writeNamedEvent(res, 'done', {})).toBe(false);
        expect(writeDataEvent(res, {})).toBe(false);
        expect(res.write).not.toHaveBeenCalled();
    });

    it('preserves the callers’ write-error contracts', () => {
        const res = response({ write: vi.fn(() => { throw new Error('closed'); }) });
        expect(writeDataEvent(res, {})).toBe(false);
        expect(() => writeNamedEvent(res, 'done', {})).toThrow('closed');
    });
});
