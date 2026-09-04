/**
 * Verifies that the SSE handler correctly maps 'background-tasks'
 * ProcessOutputEvents to SSE events.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BackgroundTasksInfo, ProcessStore, ProcessOutputEvent } from '@plusplusoneplusplus/forge';
import { handleProcessStream } from '../../src/server/streaming/sse-handler';
import { BackgroundTasksRegistry } from '../../src/server/streaming/background-tasks-registry';
import type { WarmStatusBridge } from '../../src/server/streaming/warm-status-bridge';
import { createMockProcessStore, createProcessFixture } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// SSE harness (mirrors sse-warm-status.test.ts)
// ============================================================================

interface SSEEvent {
    event: string;
    data: unknown;
}

function parseSSEFrames(chunks: string[]): SSEEvent[] {
    const frames: SSEEvent[] = [];
    for (const part of chunks.join('').split('\n\n').filter(Boolean)) {
        let event = '';
        let data = '';
        for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) { event = line.slice(7); }
            if (line.startsWith('data: ')) { data = line.slice(6); }
        }
        if (event && data) { frames.push({ event, data: JSON.parse(data) }); }
    }
    return frames;
}

function createMockReq(url = '/api/processes/p/stream'): IncomingMessage {
    const req = new PassThrough() as unknown as IncomingMessage;
    (req as { url?: string }).url = url;
    return req;
}

function createMockRes(): ServerResponse & { _chunks: string[] } {
    const chunks: string[] = [];
    const res = {
        _chunks: chunks,
        writeHead: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn((chunk: string) => { chunks.push(chunk); }),
        end: vi.fn((body?: string) => { if (body) { chunks.push(body); } }),
    };
    return res as unknown as ServerResponse & { _chunks: string[] };
}

/** Bridge stub: the replay path must not depend on warm-status wiring. */
function createNoopBridge(): WarmStatusBridge {
    return {
        register: vi.fn(() => vi.fn()),
        getCurrentStatus: vi.fn(() => 'cold'),
    } as unknown as WarmStatusBridge;
}

/**
 * Simulate the SSE event mapping logic from handleProcessStream.
 * We extract just the event-type dispatch to test it in isolation.
 */
function simulateSSEDispatch(event: ProcessOutputEvent): { eventName: string; payload: unknown } | null {
    if (event.type === 'background-tasks') {
        return {
            eventName: 'background-tasks',
            payload: {
                backgroundAgents: event.backgroundAgents,
                backgroundShells: event.backgroundShells,
                backgroundTotalActive: event.backgroundTotalActive,
                backgroundWaitingForDrain: event.backgroundWaitingForDrain,
            },
        };
    }
    return null;
}

describe('SSE background-tasks event', () => {
    it('maps background-tasks ProcessOutputEvent to SSE payload', () => {
        const event: ProcessOutputEvent = {
            type: 'background-tasks',
            backgroundAgents: [{ id: 'a1', description: 'research' }],
            backgroundShells: [{ id: 's1', description: 'npm run build' }],
            backgroundTotalActive: 2,
            backgroundWaitingForDrain: true,
        };

        const result = simulateSSEDispatch(event);
        expect(result).toEqual({
            eventName: 'background-tasks',
            payload: {
                backgroundAgents: [{ id: 'a1', description: 'research' }],
                backgroundShells: [{ id: 's1', description: 'npm run build' }],
                backgroundTotalActive: 2,
                backgroundWaitingForDrain: true,
            },
        });
    });

    it('maps background-tasks with zero active tasks', () => {
        const event: ProcessOutputEvent = {
            type: 'background-tasks',
            backgroundAgents: [],
            backgroundShells: [],
            backgroundTotalActive: 0,
            backgroundWaitingForDrain: false,
        };

        const result = simulateSSEDispatch(event);
        expect(result).toEqual({
            eventName: 'background-tasks',
            payload: {
                backgroundAgents: [],
                backgroundShells: [],
                backgroundTotalActive: 0,
                backgroundWaitingForDrain: false,
            },
        });
    });

    it('maps background-tasks with agents only', () => {
        const event: ProcessOutputEvent = {
            type: 'background-tasks',
            backgroundAgents: [
                { id: 'a1', type: 'sub-agent', description: 'exploring code' },
                { id: 'a2', type: 'sub-agent', description: 'writing tests' },
            ],
            backgroundShells: [],
            backgroundTotalActive: 2,
            backgroundWaitingForDrain: true,
        };

        const result = simulateSSEDispatch(event);
        expect(result?.payload).toEqual({
            backgroundAgents: [
                { id: 'a1', type: 'sub-agent', description: 'exploring code' },
                { id: 'a2', type: 'sub-agent', description: 'writing tests' },
            ],
            backgroundShells: [],
            backgroundTotalActive: 2,
            backgroundWaitingForDrain: true,
        });
    });

    it('does not dispatch for non-background-tasks events', () => {
        const chunkEvent: ProcessOutputEvent = { type: 'chunk', content: 'hello' };
        expect(simulateSSEDispatch(chunkEvent)).toBeNull();

        const toolEvent: ProcessOutputEvent = { type: 'tool-start', toolCallId: 'tc1', toolName: 'read' };
        expect(simulateSSEDispatch(toolEvent)).toBeNull();
    });
});

// ============================================================================
// handleProcessStream replay on connect
//
// Regression: the `background-tasks` event fires only on change, so a stream
// that opened after a long-running background shell registered never saw it and
// the "waiting for background tasks" indicator stayed hidden for the whole turn.
// ============================================================================

describe('handleProcessStream background-tasks replay', () => {
    const snapshot: BackgroundTasksInfo = {
        backgroundAgents: [],
        backgroundShells: [{ id: 's1', type: 'shell', description: 'npm run test' }],
        backgroundTotalActive: 1,
        backgroundWaitingForDrain: true,
    };

    let store: MockProcessStore;
    let registry: BackgroundTasksRegistry;
    let outputCallback: ((event: ProcessOutputEvent) => void) | undefined;

    beforeEach(() => {
        store = createMockProcessStore();
        registry = new BackgroundTasksRegistry();
        outputCallback = undefined;
        store.onProcessOutput = vi.fn((_id: string, cb: (event: ProcessOutputEvent) => void) => {
            outputCallback = cb;
            return () => { outputCallback = undefined; };
        });
    });

    function backgroundFrames(res: { _chunks: string[] }) {
        return parseSSEFrames(res._chunks).filter(f => f.event === 'background-tasks');
    }

    it('replays the snapshot for a running process', async () => {
        store.processes.set('p-bg-1', createProcessFixture({ id: 'p-bg-1', status: 'running' }));
        registry.record('p-bg-1', snapshot);

        const res = createMockRes();
        await handleProcessStream(createMockReq(), res, 'p-bg-1', store, createNoopBridge(), registry);

        const frames = backgroundFrames(res);
        expect(frames).toHaveLength(1);
        expect(frames[0].data).toEqual({
            backgroundAgents: [],
            backgroundShells: [{ id: 's1', type: 'shell', description: 'npm run test' }],
            backgroundTotalActive: 1,
            backgroundWaitingForDrain: true,
        });
    });

    it('sends nothing when the process has no snapshot', async () => {
        store.processes.set('p-bg-2', createProcessFixture({ id: 'p-bg-2', status: 'running' }));

        const res = createMockRes();
        await handleProcessStream(createMockReq(), res, 'p-bg-2', store, createNoopBridge(), registry);

        expect(backgroundFrames(res)).toHaveLength(0);
    });

    it('sends nothing for a terminal process even with a stale snapshot', async () => {
        for (const status of ['completed', 'failed', 'cancelled'] as const) {
            const id = `p-bg-term-${status}`;
            store.processes.set(id, createProcessFixture({ id, status }));
            registry.record(id, snapshot);

            const res = createMockRes();
            await handleProcessStream(createMockReq(), res, id, store, createNoopBridge(), registry);

            expect(backgroundFrames(res)).toHaveLength(0);
        }
    });

    it('sends nothing on the warm-only stream', async () => {
        store.processes.set('p-bg-3', createProcessFixture({ id: 'p-bg-3', status: 'running' }));
        registry.record('p-bg-3', snapshot);

        const req = createMockReq('/api/processes/p-bg-3/stream?warm=1');
        const res = createMockRes();
        await handleProcessStream(req, res, 'p-bg-3', store, createNoopBridge(), registry);

        expect(backgroundFrames(res)).toHaveLength(0);
    });

    it('lets a live event win over the older snapshot', async () => {
        store.processes.set('p-bg-4', createProcessFixture({ id: 'p-bg-4', status: 'running' }));
        registry.record('p-bg-4', snapshot);

        // A live event lands the instant the handler subscribes — before the
        // replay would run. The client is last-write-wins, so the stale snapshot
        // must not be sent after it.
        store.onProcessOutput = vi.fn((_id: string, cb: (event: ProcessOutputEvent) => void) => {
            cb({
                type: 'background-tasks',
                backgroundAgents: [],
                backgroundShells: [],
                backgroundTotalActive: 0,
                backgroundWaitingForDrain: false,
            });
            return () => { /* unsubscribe */ };
        });

        const res = createMockRes();
        await handleProcessStream(createMockReq(), res, 'p-bg-4', store, createNoopBridge(), registry);

        const frames = backgroundFrames(res);
        expect(frames).toHaveLength(1);
        expect((frames[0].data as BackgroundTasksInfo).backgroundTotalActive).toBe(0);
    });

    it('still relays live events after the replay', async () => {
        store.processes.set('p-bg-5', createProcessFixture({ id: 'p-bg-5', status: 'running' }));
        registry.record('p-bg-5', snapshot);

        const res = createMockRes();
        await handleProcessStream(createMockReq(), res, 'p-bg-5', store, createNoopBridge(), registry);

        outputCallback!({
            type: 'background-tasks',
            backgroundAgents: [],
            backgroundShells: [],
            backgroundTotalActive: 0,
            backgroundWaitingForDrain: false,
        });

        const frames = backgroundFrames(res);
        expect(frames).toHaveLength(2);
        expect((frames[1].data as BackgroundTasksInfo).backgroundTotalActive).toBe(0);
    });
});
