/**
 * SSE Pipeline Event Tests
 *
 * Tests that the SSE handler relays pipeline-phase and pipeline-progress
 * events as named SSE events through the onProcessOutput callback.
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

describe('SSE pipeline events', () => {
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

    it('pipeline-phase event is relayed as named SSE event', async () => {
        const proc = createProcessFixture({ id: 'p-phase-1', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p-phase-1', store);
        expect(outputCallback).toBeDefined();

        outputCallback!({
            type: 'pipeline-phase',
            pipelinePhase: {
                phase: 'discovery',
                status: 'started',
                timestamp: '2026-01-01T00:00:00Z',
                itemCount: 5,
            },
        });

        const frames = parseSSEFrames(res._chunks);
        const phaseFrames = frames.filter(f => f.event === 'workflow-phase');
        expect(phaseFrames).toHaveLength(1);
        const payload = phaseFrames[0].data as any;
        expect(payload.phase).toBe('discovery');
        expect(payload.status).toBe('started');
        expect(payload.timestamp).toBe('2026-01-01T00:00:00Z');
        expect(payload.itemCount).toBe(5);
    });

    it('pipeline-progress event is relayed as named SSE event', async () => {
        const proc = createProcessFixture({ id: 'p-prog-1', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p-prog-1', store);
        expect(outputCallback).toBeDefined();

        outputCallback!({
            type: 'pipeline-progress',
            pipelineProgress: {
                phase: 'map',
                totalItems: 10,
                completedItems: 3,
                failedItems: 0,
                percentage: 30,
            },
        });

        const frames = parseSSEFrames(res._chunks);
        const progressFrames = frames.filter(f => f.event === 'workflow-progress');
        expect(progressFrames).toHaveLength(1);
        const payload = progressFrames[0].data as any;
        expect(payload.phase).toBe('map');
        expect(payload.totalItems).toBe(10);
        expect(payload.completedItems).toBe(3);
        expect(payload.failedItems).toBe(0);
        expect(payload.percentage).toBe(30);
    });

    it('pipeline events do not interfere with existing chunk/complete flow', async () => {
        const proc = createProcessFixture({ id: 'p-mixed-1', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p-mixed-1', store);
        expect(outputCallback).toBeDefined();

        // Emit a sequence: chunk → pipeline-phase → pipeline-progress → complete
        outputCallback!({ type: 'chunk', content: 'hello' });
        outputCallback!({
            type: 'pipeline-phase',
            pipelinePhase: { phase: 'input', status: 'completed', timestamp: '2026-01-01T00:00:01Z', durationMs: 100 },
        });
        outputCallback!({
            type: 'pipeline-progress',
            pipelineProgress: { phase: 'map', totalItems: 5, completedItems: 2, failedItems: 0, percentage: 40 },
        });
        outputCallback!({ type: 'complete', status: 'completed', duration: '5s' });

        const frames = parseSSEFrames(res._chunks);
        const eventNames = frames.map(f => f.event);

        expect(eventNames).toContain('chunk');
        expect(eventNames).toContain('workflow-phase');
        expect(eventNames).toContain('workflow-progress');
        expect(eventNames).toContain('status');
        expect(eventNames).toContain('done');

        // Verify correct ordering
        const chunkIdx = eventNames.indexOf('chunk');
        const phaseIdx = eventNames.indexOf('workflow-phase');
        const progressIdx = eventNames.indexOf('workflow-progress');
        const statusIdx = eventNames.indexOf('status');
        expect(chunkIdx).toBeLessThan(phaseIdx);
        expect(phaseIdx).toBeLessThan(progressIdx);
        expect(progressIdx).toBeLessThan(statusIdx);

        expect(res._ended).toBe(true);
    });

    it('pipeline-phase with status "completed" includes all fields', async () => {
        const proc = createProcessFixture({ id: 'p-stats-1', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p-stats-1', store);
        expect(outputCallback).toBeDefined();

        outputCallback!({
            type: 'pipeline-phase',
            pipelinePhase: {
                phase: 'map',
                status: 'completed',
                timestamp: '2026-01-01T00:01:00Z',
                durationMs: 12345,
                itemCount: 42,
            },
        });

        const frames = parseSSEFrames(res._chunks);
        const phaseFrames = frames.filter(f => f.event === 'workflow-phase');
        expect(phaseFrames).toHaveLength(1);
        const payload = phaseFrames[0].data as any;
        expect(payload.phase).toBe('map');
        expect(payload.status).toBe('completed');
        expect(payload.durationMs).toBe(12345);
        expect(payload.itemCount).toBe(42);
        expect(payload.timestamp).toBe('2026-01-01T00:01:00Z');
    });
});
