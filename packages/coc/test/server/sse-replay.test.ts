/**
 * SSE Replay Tests
 *
 * Tests that the SSE handler replays persisted conversationTurns as a
 * conversation-snapshot event when a client connects, before streaming
 * any live output.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConversationTurn, ProcessOutputEvent } from '@plusplusoneplusplus/pipeline-core';
import { handleProcessStream } from '@plusplusoneplusplus/coc-server';
import { createMockProcessStore, createProcessFixture } from '../helpers/mock-process-store';
import type { MockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Helpers
// ============================================================================

interface SSEEvent {
    event: string;
    data: unknown;
}

/** Parse raw SSE frames written to a PassThrough stream. */
function parseSSEFrames(chunks: string[]): SSEEvent[] {
    const raw = chunks.join('');
    const frames: SSEEvent[] = [];
    // Each frame: "event: <name>\ndata: <json>\n\n"
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

/** Create a mock IncomingMessage (just needs 'on' for close handler). */
function createMockReq(): IncomingMessage {
    const emitter = new PassThrough();
    return emitter as unknown as IncomingMessage;
}

/** Create a mock ServerResponse that captures written data. */
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

function makeTurn(role: 'user' | 'assistant', content: string, turnIndex: number, streaming?: boolean): ConversationTurn {
    return {
        role,
        content,
        timestamp: new Date('2026-01-01T00:00:00Z'),
        turnIndex,
        ...(streaming !== undefined ? { streaming } : {}),
        timeline: [],
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('SSE replay', () => {
    let store: MockProcessStore;

    beforeEach(() => {
        store = createMockProcessStore();
    });

    // Test 1: Replay full conversation as snapshot for completed process
    it('replays conversation as a snapshot for a completed process', async () => {
        const turns = [
            makeTurn('user', 'Hello', 0),
            makeTurn('assistant', 'Hi there!', 1),
            makeTurn('user', 'Explain X', 2),
            makeTurn('assistant', 'X is ...', 3),
        ];
        const proc = createProcessFixture({
            id: 'p1',
            status: 'completed',
            result: 'done result',
            conversationTurns: turns,
        });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p1', store);

        const frames = parseSSEFrames(res._chunks);
        const snapshotFrames = frames.filter(f => f.event === 'conversation-snapshot');
        const statusFrames = frames.filter(f => f.event === 'status');
        const doneFrames = frames.filter(f => f.event === 'done');

        expect(snapshotFrames).toHaveLength(1);
        const snapshot = snapshotFrames[0].data as any;
        expect(snapshot.turns).toHaveLength(4);
        expect(snapshot.turns[0].role).toBe('user');
        expect(snapshot.turns[1].role).toBe('assistant');
        expect(snapshot.turns[1].content).toBe('Hi there!');
        expect(snapshot.turns[3].content).toBe('X is ...');

        expect(statusFrames).toHaveLength(1);
        expect((statusFrames[0].data as any).status).toBe('completed');
        expect((statusFrames[0].data as any).result).toBe('done result');
        expect(doneFrames).toHaveLength(1);
        expect(res._ended).toBe(true);
    });

    // Test 2: Replay snapshot + live chunks for running process
    it('replays snapshot then streams live chunks for a running process', async () => {
        let outputCallback: ((event: ProcessOutputEvent) => void) | undefined;
        store.onProcessOutput = vi.fn((id: string, cb: (event: ProcessOutputEvent) => void) => {
            outputCallback = cb;
            return () => { outputCallback = undefined; };
        });

        const proc = createProcessFixture({
            id: 'p2',
            status: 'running',
            conversationTurns: [
                makeTurn('assistant', 'First complete reply', 0),
                makeTurn('assistant', 'Partial...', 1, true),
            ],
        });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p2', store);

        // Snapshot should be written immediately
        const replayFrames = parseSSEFrames(res._chunks);
        const snapshots = replayFrames.filter(f => f.event === 'conversation-snapshot');
        expect(snapshots).toHaveLength(1);
        expect((snapshots[0].data as any).turns).toHaveLength(2);

        // Simulate live chunks arriving
        expect(outputCallback).toBeDefined();
        outputCallback!({ type: 'chunk', content: ' more content' });

        const allFrames = parseSSEFrames(res._chunks);
        const allChunks = allFrames.filter(f => f.event === 'chunk');
        expect(allChunks).toHaveLength(1);
        expect((allChunks[0].data as any).content).toBe(' more content');

        expect(res._ended).toBe(false);
    });

    // Test 3: Connect to process with no conversationTurns
    it('streams only live chunks when conversationTurns is undefined', async () => {
        let outputCallback: ((event: ProcessOutputEvent) => void) | undefined;
        store.onProcessOutput = vi.fn((_id: string, cb: (event: ProcessOutputEvent) => void) => {
            outputCallback = cb;
            return () => { outputCallback = undefined; };
        });

        const proc = createProcessFixture({
            id: 'p3',
            status: 'running',
        });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p3', store);

        const beforeFrames = parseSSEFrames(res._chunks);
        expect(beforeFrames.filter(f => f.event === 'conversation-snapshot')).toHaveLength(0);

        outputCallback!({ type: 'chunk', content: 'live data' });

        const afterFrames = parseSSEFrames(res._chunks);
        const chunks = afterFrames.filter(f => f.event === 'chunk');
        expect(chunks).toHaveLength(1);
        expect((chunks[0].data as any).content).toBe('live data');
    });

    // Test 4: Reconnect during streaming — both connections see full snapshot
    it('replays full snapshot on each new SSE connection', async () => {
        const turns: ConversationTurn[] = [
            makeTurn('user', 'Question', 0),
            makeTurn('assistant', 'Answer part 1', 1),
            makeTurn('assistant', 'Answer part 2', 2),
        ];

        store.onProcessOutput = vi.fn(() => () => {});
        const proc = createProcessFixture({ id: 'p4', status: 'running', conversationTurns: turns });
        store.processes.set(proc.id, proc);

        const req1 = createMockReq();
        const res1 = createMockRes();
        await handleProcessStream(req1, res1, 'p4', store);

        const snapshots1 = parseSSEFrames(res1._chunks).filter(f => f.event === 'conversation-snapshot');
        expect(snapshots1).toHaveLength(1);
        expect((snapshots1[0].data as any).turns).toHaveLength(3);

        const req2 = createMockReq();
        const res2 = createMockRes();
        await handleProcessStream(req2, res2, 'p4', store);

        const snapshots2 = parseSSEFrames(res2._chunks).filter(f => f.event === 'conversation-snapshot');
        expect(snapshots2).toHaveLength(1);
        expect((snapshots2[0].data as any).turns).toHaveLength(3);
    });

    // Test 5: Empty conversationTurns array
    it('sends only status + done when conversationTurns is empty', async () => {
        const proc = createProcessFixture({
            id: 'p5',
            status: 'completed',
            result: 'final',
            conversationTurns: [],
        });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p5', store);

        const frames = parseSSEFrames(res._chunks);
        expect(frames.filter(f => f.event === 'conversation-snapshot')).toHaveLength(0);
        expect(frames.filter(f => f.event === 'chunk')).toHaveLength(0);
        expect(frames.filter(f => f.event === 'status')).toHaveLength(1);
        expect(frames.filter(f => f.event === 'done')).toHaveLength(1);
        expect(res._ended).toBe(true);
    });

    // Test 6: Only user turns — snapshot includes them
    it('includes user turns in snapshot', async () => {
        const proc = createProcessFixture({
            id: 'p6',
            status: 'completed',
            conversationTurns: [
                makeTurn('user', 'Hello', 0),
                makeTurn('user', 'Follow up', 1),
            ],
        });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req, res, 'p6', store);

        const frames = parseSSEFrames(res._chunks);
        const snapshots = frames.filter(f => f.event === 'conversation-snapshot');
        expect(snapshots).toHaveLength(1);
        expect((snapshots[0].data as any).turns).toHaveLength(2);
        expect(res._ended).toBe(true);
    });

    // Test 7: No writes after disconnect
    it('stops writing chunks to response after client disconnects', async () => {
        let outputCallback: ((e: ProcessOutputEvent) => void) | undefined;
        store.onProcessOutput = vi.fn((_id, cb) => {
            outputCallback = cb;
            return () => { outputCallback = undefined; };
        });
        const process = createProcessFixture({ id: 'p-disc', status: 'running', conversationTurns: [] });
        store.processes.set('p-disc', process);

        const req = createMockReq();
        const res = createMockRes();
        handleProcessStream(req as any, res as any, 'p-disc', store);
        await vi.waitFor(() => expect(store.onProcessOutput).toHaveBeenCalled());

        // First chunk arrives before disconnect
        outputCallback!({ type: 'chunk', content: 'before-close' });
        // Client disconnects
        (req as any).emit('close');
        // Second chunk arrives after disconnect — must NOT be written
        outputCallback?.({ type: 'chunk', content: 'after-close' });

        const frames = parseSSEFrames(res._chunks);
        const chunkFrames = frames.filter(f => f.event === 'chunk');
        expect(chunkFrames).toHaveLength(1);
        expect((chunkFrames[0].data as any).content).toBe('before-close');
    });

    // Test 9: 404 for unknown process
    it('returns 404 when the process does not exist in the store', async () => {
        const req = createMockReq();
        const res = createMockRes();

        await handleProcessStream(req as any, res as any, 'nonexistent-id', store);

        expect(res._statusCode).toBe(404);
        expect(res._ended).toBe(true);
        // Must not emit any SSE frames (no conversation-snapshot, no status, no done)
        const frames = parseSSEFrames(res._chunks);
        expect(frames).toHaveLength(0);
    });

    // Test 8: Unsubscribe is called on disconnect
    it('calls the store unsubscribe function when client disconnects', async () => {
        const unsubscribe = vi.fn();
        store.onProcessOutput = vi.fn((_id, _cb) => unsubscribe);
        const process = createProcessFixture({ id: 'p-unsub', status: 'running', conversationTurns: [] });
        store.processes.set('p-unsub', process);

        const req = createMockReq();
        const res = createMockRes();
        handleProcessStream(req as any, res as any, 'p-unsub', store);
        await vi.waitFor(() => expect(store.onProcessOutput).toHaveBeenCalled());

        (req as any).emit('close');
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});
