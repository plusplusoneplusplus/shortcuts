/**
 * SSE Message Event Tests
 *
 * Tests that the SSE handler correctly relays message-queued events
 * including the optimisticId field for client-side reconciliation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProcessOutputEvent } from '@plusplusoneplusplus/forge';
import { handleProcessStream } from '../../src/server/streaming/sse-handler';
import { createMockProcessStore, createProcessFixture } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Helpers
// ============================================================================

interface SSEEvent {
    event: string;
    data: unknown;
}

function parseSSEFrames(chunks: string[]): SSEEvent[] {
    const raw = chunks.join('');
    const frames: SSEEvent[] = [];
    const parts = raw.split('\n\n').filter(Boolean);
    for (const part of parts) {
        const lines = part.split('\n');
        let event = '';
        let data = '';
        for (const line of lines) {
            if (line.startsWith('event: ')) { event = line.slice(7); }
            if (line.startsWith('data: ')) { data = line.slice(6); }
        }
        if (event && data) {
            frames.push({ event, data: JSON.parse(data) });
        }
    }
    return frames;
}

function createMockReq(): IncomingMessage {
    const emitter = new PassThrough();
    return emitter as unknown as IncomingMessage;
}

function createMockRes(): ServerResponse & { _chunks: string[]; _ended: boolean; _statusCode: number } {
    const chunks: string[] = [];
    let ended = false;
    let statusCode = 200;

    const res = {
        _chunks: chunks,
        _ended: ended,
        _statusCode: statusCode,
        writeHead: vi.fn((code: number) => { statusCode = code; res._statusCode = code; }),
        flushHeaders: vi.fn(),
        write: vi.fn((chunk: string) => { chunks.push(chunk); }),
        end: vi.fn((body?: string) => {
            if (body) { chunks.push(body); }
            ended = true;
            res._ended = true;
        }),
    };

    return res as unknown as ServerResponse & { _chunks: string[]; _ended: boolean; _statusCode: number };
}

// ============================================================================
// Tests
// ============================================================================

describe('SSE message-queued events', () => {
    let store: MockProcessStore;
    let outputCallback: ((event: ProcessOutputEvent) => void) | undefined;

    beforeEach(() => {
        store = createMockProcessStore();
        outputCallback = undefined;
        store.onProcessOutput = vi.fn((_id: string, cb: (event: ProcessOutputEvent) => void) => {
            outputCallback = cb;
            return () => { outputCallback = undefined; };
        });
    });

    it('relays optimisticId in message-queued event when present', async () => {
        const proc = createProcessFixture({ id: 'p-mq-1', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p-mq-1', store);
        expect(outputCallback).toBeDefined();

        outputCallback!({
            type: 'message-queued',
            turnIndex: 2,
            deliveryMode: 'enqueue',
            queuePosition: 1,
            optimisticId: 'opt-abc-123',
        } as ProcessOutputEvent);

        const frames = parseSSEFrames(res._chunks);
        const mqFrames = frames.filter(f => f.event === 'message-queued');
        expect(mqFrames).toHaveLength(1);

        const payload = mqFrames[0].data as any;
        expect(payload.turnIndex).toBe(2);
        expect(payload.deliveryMode).toBe('enqueue');
        expect(payload.queuePosition).toBe(1);
        expect(payload.optimisticId).toBe('opt-abc-123');
    });

    it('omits optimisticId in message-queued event when not present', async () => {
        const proc = createProcessFixture({ id: 'p-mq-2', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p-mq-2', store);
        expect(outputCallback).toBeDefined();

        outputCallback!({
            type: 'message-queued',
            turnIndex: 0,
            deliveryMode: 'immediate',
            queuePosition: 0,
        } as ProcessOutputEvent);

        const frames = parseSSEFrames(res._chunks);
        const mqFrames = frames.filter(f => f.event === 'message-queued');
        expect(mqFrames).toHaveLength(1);

        const payload = mqFrames[0].data as any;
        expect(payload.turnIndex).toBe(0);
        expect(payload.deliveryMode).toBe('immediate');
        expect(payload.queuePosition).toBe(0);
        expect(payload).not.toHaveProperty('optimisticId');
    });

    it('message-queued event does not interfere with other events', async () => {
        const proc = createProcessFixture({ id: 'p-mq-3', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p-mq-3', store);
        expect(outputCallback).toBeDefined();

        outputCallback!({ type: 'chunk', content: 'hello' });
        outputCallback!({
            type: 'message-queued',
            turnIndex: 1,
            deliveryMode: 'enqueue',
            queuePosition: 1,
            optimisticId: 'opt-xyz',
        } as ProcessOutputEvent);
        outputCallback!({ type: 'complete', status: 'completed', duration: '2s' });

        const frames = parseSSEFrames(res._chunks);
        const eventNames = frames.map(f => f.event);
        expect(eventNames).toContain('chunk');
        expect(eventNames).toContain('message-queued');
        expect(eventNames).toContain('status');
        expect(eventNames).toContain('done');
    });
});
