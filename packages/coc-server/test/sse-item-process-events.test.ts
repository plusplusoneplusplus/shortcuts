/**
 * SSE Item-Process Event Tests
 *
 * Tests that the SSE handler relays item-process events as named SSE events
 * for real-time per-item progress during pipeline map execution.
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

describe('SSE item-process events', () => {
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

    it('item-process event is relayed as named SSE event', async () => {
        const proc = createProcessFixture({ id: 'p-item-1', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p-item-1', store);
        expect(outputCallback).toBeDefined();

        outputCallback!({
            type: 'item-process',
            itemProcess: {
                itemIndex: 0,
                processId: 'p-item-1-m0',
                status: 'running',
                phase: 'map',
            },
        });

        const frames = parseSSEFrames(res._chunks);
        const itemFrames = frames.filter(f => f.event === 'item-process');
        expect(itemFrames).toHaveLength(1);
        const payload = itemFrames[0].data as any;
        expect(payload.itemIndex).toBe(0);
        expect(payload.processId).toBe('p-item-1-m0');
        expect(payload.status).toBe('running');
        expect(payload.phase).toBe('map');
    });

    it('event data includes correct itemIndex, processId, and status', async () => {
        const proc = createProcessFixture({ id: 'p-item-2', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p-item-2', store);

        outputCallback!({
            type: 'item-process',
            itemProcess: {
                itemIndex: 5,
                processId: 'p-item-2-m5',
                status: 'completed',
                phase: 'map',
                itemLabel: 'row-5',
            },
        });

        const frames = parseSSEFrames(res._chunks);
        const itemFrames = frames.filter(f => f.event === 'item-process');
        expect(itemFrames).toHaveLength(1);
        const payload = itemFrames[0].data as any;
        expect(payload.itemIndex).toBe(5);
        expect(payload.processId).toBe('p-item-2-m5');
        expect(payload.status).toBe('completed');
        expect(payload.itemLabel).toBe('row-5');
    });

    it('failed items emit event with error field populated', async () => {
        const proc = createProcessFixture({ id: 'p-item-fail', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p-item-fail', store);

        outputCallback!({
            type: 'item-process',
            itemProcess: {
                itemIndex: 3,
                processId: 'p-item-fail-m3',
                status: 'failed',
                phase: 'map',
                error: 'AI timeout after 30s',
            },
        });

        const frames = parseSSEFrames(res._chunks);
        const itemFrames = frames.filter(f => f.event === 'item-process');
        expect(itemFrames).toHaveLength(1);
        const payload = itemFrames[0].data as any;
        expect(payload.status).toBe('failed');
        expect(payload.error).toBe('AI timeout after 30s');
        expect(payload.itemIndex).toBe(3);
    });

    it('events arrive with correct indices for multiple items', async () => {
        const proc = createProcessFixture({ id: 'p-item-multi', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p-item-multi', store);

        // Simulate 3 items starting (possibly out of order)
        outputCallback!({
            type: 'item-process',
            itemProcess: { itemIndex: 2, processId: 'p-item-multi-m2', status: 'running', phase: 'map' },
        });
        outputCallback!({
            type: 'item-process',
            itemProcess: { itemIndex: 0, processId: 'p-item-multi-m0', status: 'running', phase: 'map' },
        });
        outputCallback!({
            type: 'item-process',
            itemProcess: { itemIndex: 1, processId: 'p-item-multi-m1', status: 'running', phase: 'map' },
        });

        const frames = parseSSEFrames(res._chunks);
        const itemFrames = frames.filter(f => f.event === 'item-process');
        expect(itemFrames).toHaveLength(3);

        const indices = itemFrames.map(f => (f.data as any).itemIndex);
        // Out of order is fine, but indices must be accurate
        expect(indices).toContain(0);
        expect(indices).toContain(1);
        expect(indices).toContain(2);
    });

    it('non-pipeline processes do not emit item-process events', async () => {
        const proc = createProcessFixture({ id: 'p-plain', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p-plain', store);

        // Emit only chunk and complete — no item-process events
        outputCallback!({ type: 'chunk', content: 'hello world' });
        outputCallback!({ type: 'complete', status: 'completed', duration: '2s' });

        const frames = parseSSEFrames(res._chunks);
        const itemFrames = frames.filter(f => f.event === 'item-process');
        expect(itemFrames).toHaveLength(0);

        // But chunk and status events should exist
        expect(frames.some(f => f.event === 'chunk')).toBe(true);
        expect(frames.some(f => f.event === 'status')).toBe(true);
    });

    it('sendEvent produces correct SSE frame format for item-process type', async () => {
        const proc = createProcessFixture({ id: 'p-frame', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p-frame', store);

        outputCallback!({
            type: 'item-process',
            itemProcess: {
                itemIndex: 7,
                processId: 'p-frame-m7',
                status: 'completed',
                phase: 'map',
                itemLabel: 'test-label',
            },
        });

        // Verify raw SSE frame format
        const rawOutput = res._chunks.join('');
        expect(rawOutput).toContain('event: item-process\n');
        expect(rawOutput).toContain('"itemIndex":7');
        expect(rawOutput).toContain('"processId":"p-frame-m7"');
        expect(rawOutput).toContain('"status":"completed"');
        expect(rawOutput).toContain('"phase":"map"');
        expect(rawOutput).toContain('"itemLabel":"test-label"');
    });

    it('item-process events do not interfere with existing pipeline event flow', async () => {
        const proc = createProcessFixture({ id: 'p-mixed-item', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p-mixed-item', store);

        // Emit sequence: pipeline-phase → item-process → pipeline-progress → item-process → complete
        outputCallback!({
            type: 'pipeline-phase',
            pipelinePhase: { phase: 'map', status: 'started', timestamp: '2026-01-01T00:00:00Z', itemCount: 2 },
        });
        outputCallback!({
            type: 'item-process',
            itemProcess: { itemIndex: 0, processId: 'p-mixed-item-m0', status: 'running', phase: 'map' },
        });
        outputCallback!({
            type: 'pipeline-progress',
            pipelineProgress: { phase: 'map', totalItems: 2, completedItems: 0, failedItems: 0, percentage: 0 },
        });
        outputCallback!({
            type: 'item-process',
            itemProcess: { itemIndex: 0, processId: 'p-mixed-item-m0', status: 'completed', phase: 'map' },
        });
        outputCallback!({ type: 'complete', status: 'completed', duration: '3s' });

        const frames = parseSSEFrames(res._chunks);
        const eventNames = frames.map(f => f.event);

        expect(eventNames).toContain('workflow-phase');
        expect(eventNames).toContain('item-process');
        expect(eventNames).toContain('workflow-progress');
        expect(eventNames).toContain('status');
        expect(eventNames).toContain('done');

        // item-process events should be in correct order
        const itemFrames = frames.filter(f => f.event === 'item-process');
        expect(itemFrames).toHaveLength(2);
        expect((itemFrames[0].data as any).status).toBe('running');
        expect((itemFrames[1].data as any).status).toBe('completed');

        expect(res._ended).toBe(true);
    });
});
