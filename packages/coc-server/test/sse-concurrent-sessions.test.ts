/**
 * SSE Concurrent Sessions & Chat-Switch Isolation Tests
 *
 * Tests verifying that simultaneous SSE connections to two different processes
 * are fully isolated — each receives only its own snapshot and chunks — and that
 * closing one connection (simulating a chat switch) does not affect the other.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConversationTurn, ProcessOutputEvent } from '@plusplusoneplusplus/pipeline-core';
import { handleProcessStream } from '../src/sse-handler';
import { createMockProcessStore, createProcessFixture } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Helpers
// ============================================================================

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

function makeTurn(role: 'user' | 'assistant', content: string): ConversationTurn {
    return {
        role,
        content,
        timestamp: new Date('2026-01-01T00:00:00Z'),
        timeline: [],
    };
}

function parseSSEFrames(chunks: string[]): Array<{ event: string; data: string }> {
    const raw = chunks.join('');
    const frames: Array<{ event: string; data: string }> = [];
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
            frames.push({ event, data });
        }
    }
    return frames;
}

// ============================================================================
// Tests
// ============================================================================

describe('SSE concurrent sessions & chat-switch isolation', () => {
    let storeA: MockProcessStore;
    let storeB: MockProcessStore;
    let callbackA: ((e: ProcessOutputEvent) => void) | undefined;
    let callbackB: ((e: ProcessOutputEvent) => void) | undefined;

    beforeEach(() => {
        storeA = createMockProcessStore();
        storeB = createMockProcessStore();
        callbackA = undefined;
        callbackB = undefined;
        storeA.onProcessOutput = vi.fn((_id, cb) => { callbackA = cb; return () => { callbackA = undefined; }; });
        storeB.onProcessOutput = vi.fn((_id, cb) => { callbackB = cb; return () => { callbackB = undefined; }; });
    });

    it('two concurrent SSE connections to different processes each receive their own snapshot', async () => {
        const processA = createProcessFixture({
            id: 'chat-A',
            status: 'running',
            conversationTurns: [makeTurn('user', 'Hello from A'), makeTurn('assistant', 'Reply A')],
        });
        const processB = createProcessFixture({
            id: 'chat-B',
            status: 'running',
            conversationTurns: [makeTurn('user', 'Hello from B')],
        });
        storeA.processes.set('chat-A', processA);
        storeB.processes.set('chat-B', processB);

        const reqA = createMockReq(); const resA = createMockRes();
        const reqB = createMockReq(); const resB = createMockRes();

        handleProcessStream(reqA as any, resA as any, 'chat-A', storeA);
        handleProcessStream(reqB as any, resB as any, 'chat-B', storeB);

        await vi.waitFor(() => {
            expect(resA._chunks.length).toBeGreaterThan(0);
            expect(resB._chunks.length).toBeGreaterThan(0);
        });

        const snapshotA = parseSSEFrames(resA._chunks).find(f => f.event === 'conversation-snapshot');
        const snapshotB = parseSSEFrames(resB._chunks).find(f => f.event === 'conversation-snapshot');

        expect(snapshotA).toBeDefined();
        expect(snapshotB).toBeDefined();
        expect(JSON.parse(snapshotA!.data).turns).toHaveLength(2);
        expect(JSON.parse(snapshotB!.data).turns).toHaveLength(1);
        expect(JSON.parse(snapshotA!.data).turns[0].content).toBe('Hello from A');
        expect(JSON.parse(snapshotB!.data).turns[0].content).toBe('Hello from B');
    });

    it('closing SSE connection A (chat switch) does not affect connection B live stream', async () => {
        const processA = createProcessFixture({ id: 'switch-A', status: 'running', conversationTurns: [] });
        const processB = createProcessFixture({ id: 'switch-B', status: 'running', conversationTurns: [] });
        storeA.processes.set('switch-A', processA);
        storeB.processes.set('switch-B', processB);

        const reqA = createMockReq(); const resA = createMockRes();
        const reqB = createMockReq(); const resB = createMockRes();

        handleProcessStream(reqA as any, resA as any, 'switch-A', storeA);
        handleProcessStream(reqB as any, resB as any, 'switch-B', storeB);

        await vi.waitFor(() => {
            expect((storeA.onProcessOutput as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
            expect((storeB.onProcessOutput as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
        });

        // Chunks arrive on both before switch
        callbackA!({ type: 'chunk', content: 'A-before-switch' });
        callbackB!({ type: 'chunk', content: 'B-before-switch' });

        // User switches: close A
        (reqA as any).emit('close');

        // Chunks after switch: A's callback becomes undefined after unsubscribe
        callbackA?.({ type: 'chunk', content: 'A-after-switch' });
        callbackB!({ type: 'chunk', content: 'B-after-switch' });

        const framesA = parseSSEFrames(resA._chunks);
        const framesB = parseSSEFrames(resB._chunks);

        const chunksA = framesA.filter(f => f.event === 'chunk').map(f => JSON.parse(f.data).content);
        const chunksB = framesB.filter(f => f.event === 'chunk').map(f => JSON.parse(f.data).content);

        expect(chunksA).toEqual(['A-before-switch']);                        // stopped at switch
        expect(chunksB).toEqual(['B-before-switch', 'B-after-switch']);      // unaffected
    });

    it('chat-switch pattern: close A, immediately open B, B gets correct snapshot', async () => {
        const processA = createProcessFixture({
            id: 'seq-A',
            status: 'running',
            conversationTurns: [makeTurn('user', 'A turn')],
        });
        const processB = createProcessFixture({
            id: 'seq-B',
            status: 'running',
            conversationTurns: [makeTurn('user', 'B turn 1'), makeTurn('assistant', 'B answer')],
        });
        storeA.processes.set('seq-A', processA);
        storeB.processes.set('seq-B', processB);

        // Connect to A
        const reqA = createMockReq(); const resA = createMockRes();
        handleProcessStream(reqA as any, resA as any, 'seq-A', storeA);
        await vi.waitFor(() => expect(resA._chunks.length).toBeGreaterThan(0));

        // Switch: close A, open B
        (reqA as any).emit('close');
        const reqB = createMockReq(); const resB = createMockRes();
        handleProcessStream(reqB as any, resB as any, 'seq-B', storeB);
        await vi.waitFor(() => expect(resB._chunks.length).toBeGreaterThan(0));

        // B should have 2-turn snapshot
        const snapshotB = parseSSEFrames(resB._chunks).find(f => f.event === 'conversation-snapshot');
        expect(snapshotB).toBeDefined();
        expect(JSON.parse(snapshotB!.data).turns).toHaveLength(2);
        expect(JSON.parse(snapshotB!.data).turns[1].content).toBe('B answer');

        // A is closed — no more writes after 'close'
        callbackA?.({ type: 'chunk', content: 'ghost-chunk' });
        const chunksA = parseSSEFrames(resA._chunks).filter(f => f.event === 'chunk');
        expect(chunksA).toHaveLength(0);
    });
});
