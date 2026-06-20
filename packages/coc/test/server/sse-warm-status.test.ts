/**
 * SSE Handler — warm_status Event Tests
 *
 * Verifies that:
 *   - emitWarmStatus emits a `warm-status` ProcessOutputEvent through the store;
 *   - handleProcessStream relays a `warm-status` output event to the SPA as a
 *     `warm_status` SSE frame carrying `{ status }` (AC-01);
 *   - handleProcessStream registers/unregisters warm-status interest with the
 *     WarmStatusBridge over the life of the stream.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProcessOutputEvent, ProcessStore } from '@plusplusoneplusplus/forge';
import { handleProcessStream, emitWarmStatus } from '../../src/server/streaming/sse-handler';
import type { WarmStatusBridge } from '../../src/server/streaming/warm-status-bridge';
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

function createMockRes(): ServerResponse & { _chunks: string[]; _ended: boolean } {
    const chunks: string[] = [];
    let ended = false;
    const res = {
        _chunks: chunks,
        _ended: ended,
        writeHead: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn((chunk: string) => { chunks.push(chunk); }),
        end: vi.fn((body?: string) => { if (body) { chunks.push(body); } ended = true; res._ended = true; }),
    };
    return res as unknown as ServerResponse & { _chunks: string[]; _ended: boolean };
}

/** A no-op bridge that records register/unregister so wiring can be asserted. */
function createSpyBridge() {
    const unregister = vi.fn();
    const register = vi.fn(() => unregister);
    return { register, unregister } as unknown as WarmStatusBridge & {
        register: ReturnType<typeof vi.fn>;
        unregister: ReturnType<typeof vi.fn>;
    };
}

// ============================================================================
// emitWarmStatus helper
// ============================================================================

describe('emitWarmStatus', () => {
    function createEmitOnlyStore(): Pick<ProcessStore, 'emitProcessEvent'> {
        return { emitProcessEvent: vi.fn() };
    }

    it('emits a warm-status event with the given status', () => {
        const store = createEmitOnlyStore();
        emitWarmStatus(store as any, 'proc-1', 'warming');
        expect(store.emitProcessEvent).toHaveBeenCalledTimes(1);
        expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-1', { type: 'warm-status', warmStatus: 'warming' });
    });
});

// ============================================================================
// handleProcessStream relay
// ============================================================================

describe('SSE warm_status relay', () => {
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

    it('relays a warm-status output event to a warm_status SSE frame with { status }', async () => {
        const proc = createProcessFixture({ id: 'p-warm-1', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'p-warm-1', store, createSpyBridge());
        expect(outputCallback).toBeDefined();

        outputCallback!({ type: 'warm-status', warmStatus: 'warm' } as unknown as ProcessOutputEvent);

        const frames = parseSSEFrames(res._chunks).filter(f => f.event === 'warm_status');
        expect(frames).toHaveLength(1);
        expect(frames[0].data).toEqual({ status: 'warm' });
    });

    it('relays each lifecycle status verbatim', async () => {
        const proc = createProcessFixture({ id: 'p-warm-2', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'p-warm-2', store, createSpyBridge());

        for (const status of ['warming', 'active', 'warm', 'cold'] as const) {
            outputCallback!({ type: 'warm-status', warmStatus: status } as unknown as ProcessOutputEvent);
        }

        const statuses = parseSSEFrames(res._chunks)
            .filter(f => f.event === 'warm_status')
            .map(f => (f.data as { status: string }).status);
        expect(statuses).toEqual(['warming', 'active', 'warm', 'cold']);
    });

    it('ignores a warm-status event with no status', async () => {
        const proc = createProcessFixture({ id: 'p-warm-3', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'p-warm-3', store, createSpyBridge());

        outputCallback!({ type: 'warm-status' } as unknown as ProcessOutputEvent);

        const frames = parseSSEFrames(res._chunks).filter(f => f.event === 'warm_status');
        expect(frames).toHaveLength(0);
    });

    it('does not interfere with other relayed events', async () => {
        const proc = createProcessFixture({ id: 'p-warm-4', status: 'running' });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'p-warm-4', store, createSpyBridge());

        outputCallback!({ type: 'chunk', content: 'hi' });
        outputCallback!({ type: 'warm-status', warmStatus: 'warm' } as unknown as ProcessOutputEvent);
        outputCallback!({ type: 'complete', status: 'completed', duration: '1s' });

        const eventNames = parseSSEFrames(res._chunks).map(f => f.event);
        expect(eventNames).toContain('chunk');
        expect(eventNames).toContain('warm_status');
        expect(eventNames).toContain('status');
        expect(eventNames).toContain('done');
    });
});

// ============================================================================
// handleProcessStream ↔ WarmStatusBridge wiring
// ============================================================================

describe('handleProcessStream warm-interest wiring', () => {
    let store: MockProcessStore;

    beforeEach(() => {
        store = createMockProcessStore();
        store.onProcessOutput = vi.fn(() => () => { /* unsubscribe */ });
    });

    it('registers interest with the bridge using the process provider + cwd', async () => {
        const proc = createProcessFixture({
            id: 'p-reg-1',
            status: 'running',
            workingDirectory: '/repo',
            metadata: { provider: 'codex' } as any,
        });
        store.processes.set(proc.id, proc);

        const bridge = createSpyBridge();
        await handleProcessStream(createMockReq(), createMockRes(), 'p-reg-1', store, bridge);

        expect(bridge.register).toHaveBeenCalledTimes(1);
        expect(bridge.register).toHaveBeenCalledWith({
            store,
            processId: 'p-reg-1',
            provider: 'codex',
            workingDirectory: '/repo',
        });
    });

    it('defaults an unknown/absent provider to copilot', async () => {
        const proc = createProcessFixture({ id: 'p-reg-2', status: 'running', workingDirectory: '/repo' });
        store.processes.set(proc.id, proc);

        const bridge = createSpyBridge();
        await handleProcessStream(createMockReq(), createMockRes(), 'p-reg-2', store, bridge);

        expect(bridge.register).toHaveBeenCalledWith(expect.objectContaining({ provider: 'copilot' }));
    });

    it('unregisters interest when the client disconnects', async () => {
        const proc = createProcessFixture({ id: 'p-reg-3', status: 'running' });
        store.processes.set(proc.id, proc);

        const bridge = createSpyBridge();
        const req = createMockReq();
        await handleProcessStream(req, createMockRes(), 'p-reg-3', store, bridge);

        expect(bridge.unregister).not.toHaveBeenCalled();
        (req as unknown as PassThrough).emit('close');
        expect(bridge.unregister).toHaveBeenCalledTimes(1);
    });

    it('does not register interest for an already-completed process (one-shot stream)', async () => {
        const proc = createProcessFixture({ id: 'p-reg-4', status: 'completed' });
        store.processes.set(proc.id, proc);

        const bridge = createSpyBridge();
        await handleProcessStream(createMockReq(), createMockRes(), 'p-reg-4', store, bridge);

        expect(bridge.register).not.toHaveBeenCalled();
    });
});
