/**
 * SSE Handler — message-queued / message-steering Dispatch Tests
 *
 * Verifies that handleProcessStream correctly relays message-queued and
 * message-steering ProcessOutputEvents to SSE clients as named events.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProcessOutputEvent } from '@plusplusoneplusplus/pipeline-core';
import { handleProcessStream } from '../src/sse-handler';
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
    for (const part of raw.split('\n\n').filter(Boolean)) {
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
    return new PassThrough() as unknown as IncomingMessage;
}

function createMockRes(): ServerResponse & { _chunks: string[]; _ended: boolean } {
    const chunks: string[] = [];
    const res = {
        _chunks: chunks,
        _ended: false,
        writeHead: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn((chunk: string) => { chunks.push(chunk); }),
        end: vi.fn((body?: string) => {
            if (body) { chunks.push(body); }
            res._ended = true;
        }),
    };
    return res as unknown as ServerResponse & { _chunks: string[]; _ended: boolean };
}

// ============================================================================
// Tests
// ============================================================================

describe('SSE handler — message-queued / message-steering dispatch', () => {
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

    // -------------------------------------------------------------------------
    // message-queued dispatch
    // -------------------------------------------------------------------------

    it('relays message-queued (enqueue) as a named SSE event', async () => {
        const proc = createProcessFixture({ id: 'mq-1', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'mq-1', store);

        outputCallback!({
            type: 'message-queued',
            turnIndex: 3,
            deliveryMode: 'enqueue',
            queuePosition: 1,
        } as ProcessOutputEvent);

        const frames = parseSSEFrames(res._chunks);
        const mq = frames.filter(f => f.event === 'message-queued');
        expect(mq).toHaveLength(1);
        expect(mq[0].data).toMatchObject({ turnIndex: 3, deliveryMode: 'enqueue', queuePosition: 1 });
    });

    it('relays message-queued (immediate) with queuePosition 0', async () => {
        const proc = createProcessFixture({ id: 'mq-2', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'mq-2', store);

        outputCallback!({
            type: 'message-queued',
            turnIndex: 0,
            deliveryMode: 'immediate',
            queuePosition: 0,
        } as ProcessOutputEvent);

        const frames = parseSSEFrames(res._chunks);
        const mq = frames.filter(f => f.event === 'message-queued');
        expect(mq).toHaveLength(1);
        expect(mq[0].data).toMatchObject({ turnIndex: 0, deliveryMode: 'immediate', queuePosition: 0 });
    });

    it('includes all required fields in the message-queued SSE payload', async () => {
        const proc = createProcessFixture({ id: 'mq-3', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'mq-3', store);

        outputCallback!({
            type: 'message-queued',
            turnIndex: 7,
            deliveryMode: 'enqueue',
            queuePosition: 2,
        } as ProcessOutputEvent);

        const frames = parseSSEFrames(res._chunks);
        const payload = frames.find(f => f.event === 'message-queued')?.data as any;
        expect(payload).toBeDefined();
        expect(payload).toHaveProperty('turnIndex', 7);
        expect(payload).toHaveProperty('deliveryMode', 'enqueue');
        expect(payload).toHaveProperty('queuePosition', 2);
    });

    // -------------------------------------------------------------------------
    // message-steering dispatch
    // -------------------------------------------------------------------------

    it('relays message-steering as a named SSE event', async () => {
        const proc = createProcessFixture({ id: 'ms-1', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'ms-1', store);

        outputCallback!({
            type: 'message-steering',
            turnIndex: 5,
        } as ProcessOutputEvent);

        const frames = parseSSEFrames(res._chunks);
        const ms = frames.filter(f => f.event === 'message-steering');
        expect(ms).toHaveLength(1);
        expect(ms[0].data).toMatchObject({ turnIndex: 5 });
    });

    it('message-steering payload contains only turnIndex', async () => {
        const proc = createProcessFixture({ id: 'ms-2', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'ms-2', store);

        outputCallback!({
            type: 'message-steering',
            turnIndex: 1,
        } as ProcessOutputEvent);

        const frames = parseSSEFrames(res._chunks);
        const payload = frames.find(f => f.event === 'message-steering')?.data as any;
        expect(payload).toHaveProperty('turnIndex', 1);
        // deliveryMode should not be present on message-steering
        expect(payload).not.toHaveProperty('deliveryMode');
    });

    // -------------------------------------------------------------------------
    // Interaction with other events
    // -------------------------------------------------------------------------

    it('message-queued does not emit done event', async () => {
        const proc = createProcessFixture({ id: 'mq-nodone', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'mq-nodone', store);

        outputCallback!({
            type: 'message-queued',
            turnIndex: 2,
            deliveryMode: 'immediate',
            queuePosition: 0,
        } as ProcessOutputEvent);

        const frames = parseSSEFrames(res._chunks);
        const doneFrames = frames.filter(f => f.event === 'done');
        expect(doneFrames).toHaveLength(0);
        expect(res._ended).toBe(false);
    });

    it('message-queued and message-steering coexist in the same stream', async () => {
        const proc = createProcessFixture({ id: 'both-1', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'both-1', store);

        outputCallback!({
            type: 'message-queued',
            turnIndex: 4,
            deliveryMode: 'enqueue',
            queuePosition: 1,
        } as ProcessOutputEvent);
        outputCallback!({
            type: 'message-steering',
            turnIndex: 4,
        } as ProcessOutputEvent);
        outputCallback!({ type: 'complete', status: 'completed', duration: '1s' });

        const frames = parseSSEFrames(res._chunks);
        const eventNames = frames.map(f => f.event);
        expect(eventNames).toContain('message-queued');
        expect(eventNames).toContain('message-steering');
        expect(eventNames).toContain('done');
        // message-queued comes before message-steering
        expect(eventNames.indexOf('message-queued')).toBeLessThan(
            eventNames.indexOf('message-steering'),
        );
    });

    it('chunk events are unaffected by interleaved message-queued', async () => {
        const proc = createProcessFixture({ id: 'interleave-1', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'interleave-1', store);

        outputCallback!({ type: 'chunk', content: 'hello' });
        outputCallback!({
            type: 'message-queued',
            turnIndex: 1,
            deliveryMode: 'enqueue',
            queuePosition: 1,
        } as ProcessOutputEvent);
        outputCallback!({ type: 'chunk', content: ' world' });
        outputCallback!({ type: 'complete', status: 'completed', duration: '2s' });

        const frames = parseSSEFrames(res._chunks);
        const chunkFrames = frames.filter(f => f.event === 'chunk');
        expect(chunkFrames).toHaveLength(2);
        expect(chunkFrames[0].data).toMatchObject({ content: 'hello' });
        expect(chunkFrames[1].data).toMatchObject({ content: ' world' });
        const mqFrame = frames.find(f => f.event === 'message-queued');
        expect(mqFrame).toBeDefined();
    });
});
