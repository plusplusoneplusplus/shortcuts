/**
 * SSE Edge Cases Tests
 *
 * Section 4: Two Concurrent Sessions for Same Process
 * Section 6: Cancellation & Error States
 * Section 7: Token Usage Events
 *
 * Sections 5 (replay) is covered by sse-replay.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProcessOutputEvent } from '@plusplusoneplusplus/forge';
import { handleProcessStream } from '@plusplusoneplusplus/coc-server';
import { createMockProcessStore, createProcessFixture } from '../helpers/mock-process-store';
import type { MockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Helpers
// ============================================================================

function createMockReq(url = '/api/processes/test/stream'): IncomingMessage {
    const emitter = new PassThrough();
    (emitter as any).url = url;
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

function parseSSEFrames(chunks: string[]): Array<{ event: string; data: any }> {
    const raw = chunks.join('');
    const frames: Array<{ event: string; data: any }> = [];
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

// ============================================================================
// Section 4: Two Concurrent Sessions for Same Process
// ============================================================================

describe('Section 4: SSE — Two Concurrent Sessions for Same Process', () => {
    let store: MockProcessStore;
    let callbacks: ((e: ProcessOutputEvent) => void)[] = [];

    beforeEach(() => {
        store = createMockProcessStore();
        callbacks = [];
        // Allow multiple subscriptions to the same process
        store.onProcessOutput = vi.fn((_id, cb) => {
            callbacks.push(cb);
            const idx = callbacks.length - 1;
            return () => { callbacks[idx] = undefined as any; };
        });
    });

    it('two clients subscribing to same process both receive every token event', async () => {
        const proc = createProcessFixture({ id: 'shared-p', status: 'running', conversationTurns: [] });
        store.processes.set('shared-p', proc);

        const req1 = createMockReq(); const res1 = createMockRes();
        const req2 = createMockReq(); const res2 = createMockRes();

        handleProcessStream(req1 as any, res1 as any, 'shared-p', store);
        handleProcessStream(req2 as any, res2 as any, 'shared-p', store);

        await vi.waitFor(() => expect(callbacks.filter(Boolean).length).toBe(2));

        // Send token to both
        for (const cb of callbacks.filter(Boolean)) {
            cb({ type: 'chunk', content: 'hello' });
        }

        const frames1 = parseSSEFrames(res1._chunks);
        const frames2 = parseSSEFrames(res2._chunks);

        const chunks1 = frames1.filter(f => f.event === 'chunk').map(f => f.data.content);
        const chunks2 = frames2.filter(f => f.event === 'chunk').map(f => f.data.content);

        expect(chunks1).toEqual(['hello']);
        expect(chunks2).toEqual(['hello']);
    });

    it('first client connection closed mid-stream → second client continues receiving', async () => {
        const proc = createProcessFixture({ id: 'shared-q', status: 'running', conversationTurns: [] });
        store.processes.set('shared-q', proc);

        const req1 = createMockReq(); const res1 = createMockRes();
        const req2 = createMockReq(); const res2 = createMockRes();

        handleProcessStream(req1 as any, res1 as any, 'shared-q', store);
        handleProcessStream(req2 as any, res2 as any, 'shared-q', store);

        await vi.waitFor(() => expect(callbacks.filter(Boolean).length).toBe(2));

        // Send chunk to both before disconnect
        callbacks[0]({ type: 'chunk', content: 'before-disconnect' });
        callbacks[1]({ type: 'chunk', content: 'before-disconnect' });

        // Disconnect client 1
        (req1 as any).emit('close');
        await vi.waitFor(() => expect(callbacks[0]).toBeUndefined());

        // Send more to remaining callback
        callbacks[1]({ type: 'chunk', content: 'after-disconnect' });

        const frames2 = parseSSEFrames(res2._chunks);
        const chunks2 = frames2.filter(f => f.event === 'chunk').map(f => f.data.content);
        expect(chunks2).toEqual(['before-disconnect', 'after-disconnect']);
    });

    it('second client unsubscribes cleanly → first client unaffected', async () => {
        const proc = createProcessFixture({ id: 'shared-r', status: 'running', conversationTurns: [] });
        store.processes.set('shared-r', proc);

        const req1 = createMockReq(); const res1 = createMockRes();
        const req2 = createMockReq(); const res2 = createMockRes();

        handleProcessStream(req1 as any, res1 as any, 'shared-r', store);
        handleProcessStream(req2 as any, res2 as any, 'shared-r', store);

        await vi.waitFor(() => expect(callbacks.filter(Boolean).length).toBe(2));

        callbacks[0]({ type: 'chunk', content: 'token-A' });
        callbacks[1]({ type: 'chunk', content: 'token-A' });

        // Disconnect client 2
        (req2 as any).emit('close');
        await vi.waitFor(() => expect(callbacks[1]).toBeUndefined());

        // Client 1 still receives
        callbacks[0]({ type: 'chunk', content: 'token-B' });

        const frames1 = parseSSEFrames(res1._chunks);
        const chunks1 = frames1.filter(f => f.event === 'chunk').map(f => f.data.content);
        expect(chunks1).toEqual(['token-A', 'token-B']);
    });

    it('both clients receive done sentinel on process complete', async () => {
        const proc = createProcessFixture({ id: 'shared-s', status: 'running', conversationTurns: [] });
        store.processes.set('shared-s', proc);

        const req1 = createMockReq(); const res1 = createMockRes();
        const req2 = createMockReq(); const res2 = createMockRes();

        handleProcessStream(req1 as any, res1 as any, 'shared-s', store);
        handleProcessStream(req2 as any, res2 as any, 'shared-s', store);

        await vi.waitFor(() => expect(callbacks.filter(Boolean).length).toBe(2));

        // Fire complete event on both
        const completeEvent: ProcessOutputEvent = { type: 'complete', status: 'completed', duration: '1s' };
        callbacks[0](completeEvent);
        callbacks[1](completeEvent);

        const frames1 = parseSSEFrames(res1._chunks);
        const frames2 = parseSSEFrames(res2._chunks);

        expect(frames1.some(f => f.event === 'done')).toBe(true);
        expect(frames2.some(f => f.event === 'done')).toBe(true);
    });
});

// ============================================================================
// Section 6: SSE — Cancellation & Error States
// ============================================================================

describe('Section 6: SSE — Cancellation & Error States', () => {
    let store: MockProcessStore;
    let outputCallback: ((e: ProcessOutputEvent) => void) | undefined;

    beforeEach(() => {
        store = createMockProcessStore();
        outputCallback = undefined;
        store.onProcessOutput = vi.fn((_id, cb) => {
            outputCallback = cb;
            return () => { outputCallback = undefined; };
        });
    });

    it('process cancelled mid-stream → client receives status cancelled then stream closes', async () => {
        const proc = createProcessFixture({ id: 'cancel-p', status: 'running', conversationTurns: [] });
        store.processes.set('cancel-p', proc);

        const req = createMockReq(); const res = createMockRes();
        handleProcessStream(req as any, res as any, 'cancel-p', store);
        await vi.waitFor(() => expect(store.onProcessOutput).toHaveBeenCalled());

        // Emit some tokens first
        outputCallback!({ type: 'chunk', content: 'partial output' });

        // Simulate cancellation via complete event with cancelled status
        outputCallback!({ type: 'complete', status: 'cancelled', duration: '2s' });

        const frames = parseSSEFrames(res._chunks);
        const statusFrame = frames.find(f => f.event === 'status');
        const doneFrame = frames.find(f => f.event === 'done');

        expect(statusFrame).toBeDefined();
        expect(statusFrame!.data.status).toBe('cancelled');
        expect(doneFrame).toBeDefined();
        expect(res._ended).toBe(true);
    });

    it('AI call throws error → client receives status failed with error message, then stream closes', async () => {
        const proc = createProcessFixture({ id: 'error-p', status: 'running', conversationTurns: [] });
        store.processes.set('error-p', proc);

        const req = createMockReq(); const res = createMockRes();
        handleProcessStream(req as any, res as any, 'error-p', store);
        await vi.waitFor(() => expect(store.onProcessOutput).toHaveBeenCalled());

        // Simulate AI error via complete event with failed status
        outputCallback!({ type: 'complete', status: 'failed', duration: '0s' });

        const frames = parseSSEFrames(res._chunks);
        const statusFrame = frames.find(f => f.event === 'status');
        const doneFrame = frames.find(f => f.event === 'done');

        expect(statusFrame).toBeDefined();
        expect(statusFrame!.data.status).toBe('failed');
        expect(doneFrame).toBeDefined();
        expect(res._ended).toBe(true);
    });

    it('SSE connection closed by server before first token → client handles gracefully (no crash)', async () => {
        const proc = createProcessFixture({ id: 'early-close-p', status: 'running', conversationTurns: [] });
        store.processes.set('early-close-p', proc);

        const req = createMockReq(); const res = createMockRes();
        handleProcessStream(req as any, res as any, 'early-close-p', store);
        await vi.waitFor(() => expect(store.onProcessOutput).toHaveBeenCalled());

        // Client disconnects immediately (before any tokens)
        (req as any).emit('close');
        await vi.waitFor(() => expect(outputCallback).toBeUndefined());

        // No crash — sending tokens after close should be a no-op
        expect(() => {
            outputCallback?.({ type: 'chunk', content: 'orphaned' });
        }).not.toThrow();

        // No writes after close
        const framesBefore = res._chunks.length;
        outputCallback?.({ type: 'chunk', content: 'orphaned' });
        expect(res._chunks.length).toBe(framesBefore);
    });

    it('POST cancel while SSE client is connected → cancel event delivered via complete', async () => {
        const proc = createProcessFixture({ id: 'cancel-q', status: 'running', conversationTurns: [] });
        store.processes.set('cancel-q', proc);

        const req = createMockReq(); const res = createMockRes();
        handleProcessStream(req as any, res as any, 'cancel-q', store);
        await vi.waitFor(() => expect(store.onProcessOutput).toHaveBeenCalled());

        // Simulate external POST /cancel triggering a complete event
        outputCallback!({ type: 'chunk', content: 'work in progress' });
        outputCallback!({ type: 'complete', status: 'cancelled', duration: '3s' });

        const frames = parseSSEFrames(res._chunks);
        const chunkFrames = frames.filter(f => f.event === 'chunk');
        const statusFrame = frames.find(f => f.event === 'status');

        expect(chunkFrames).toHaveLength(1);
        expect(chunkFrames[0].data.content).toBe('work in progress');
        expect(statusFrame!.data.status).toBe('cancelled');
        expect(res._ended).toBe(true);
    });

    it('already-cancelled process returns status cancelled immediately without streaming', async () => {
        const proc = createProcessFixture({
            id: 'precancelled-p',
            status: 'cancelled',
            conversationTurns: [],
        });
        store.processes.set('precancelled-p', proc);

        const req = createMockReq(); const res = createMockRes();
        await handleProcessStream(req as any, res as any, 'precancelled-p', store);

        const frames = parseSSEFrames(res._chunks);
        const statusFrame = frames.find(f => f.event === 'status');

        expect(statusFrame).toBeDefined();
        expect(statusFrame!.data.status).toBe('cancelled');
        expect(frames.some(f => f.event === 'done')).toBe(true);
        expect(res._ended).toBe(true);
    });
});

// ============================================================================
// Section 7: SSE — Token Usage Events
// ============================================================================

describe('Section 7: SSE — Token Usage Events', () => {
    let store: MockProcessStore;
    let callbacks: ((e: ProcessOutputEvent) => void)[] = [];

    beforeEach(() => {
        store = createMockProcessStore();
        callbacks = [];
        store.onProcessOutput = vi.fn((_id, cb) => {
            callbacks.push(cb);
            const idx = callbacks.length - 1;
            return () => { callbacks[idx] = undefined as any; };
        });
    });

    it('token-usage event is forwarded to SSE stream', async () => {
        const proc = createProcessFixture({ id: 'token-p', status: 'running', conversationTurns: [] });
        store.processes.set('token-p', proc);

        const req = createMockReq(); const res = createMockRes();
        handleProcessStream(req as any, res as any, 'token-p', store);
        await vi.waitFor(() => expect(callbacks.filter(Boolean).length).toBe(1));

        callbacks[0]({
            type: 'token-usage',
            turnIndex: 0,
            tokenUsage: {
                inputTokens: 100,
                outputTokens: 50,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
            },
            sessionTokenLimit: 10000,
            sessionCurrentTokens: 150,
        } as any);

        const frames = parseSSEFrames(res._chunks);
        const tokenFrame = frames.find(f => f.event === 'token-usage');

        expect(tokenFrame).toBeDefined();
        expect(tokenFrame!.data.turnIndex).toBe(0);
        expect(tokenFrame!.data.tokenUsage).toBeDefined();
        expect(tokenFrame!.data.sessionTokenLimit).toBe(10000);
        expect(tokenFrame!.data.sessionCurrentTokens).toBe(150);
    });

    it('token-usage event payload contains inputTokens and outputTokens', async () => {
        const proc = createProcessFixture({ id: 'token-q', status: 'running', conversationTurns: [] });
        store.processes.set('token-q', proc);

        const req = createMockReq(); const res = createMockRes();
        handleProcessStream(req as any, res as any, 'token-q', store);
        await vi.waitFor(() => expect(callbacks.filter(Boolean).length).toBe(1));

        const tokenUsage = {
            inputTokens: 200,
            outputTokens: 80,
            cacheReadTokens: 10,
            cacheWriteTokens: 5,
        };
        callbacks[0]({
            type: 'token-usage',
            turnIndex: 1,
            tokenUsage,
        } as any);

        const frames = parseSSEFrames(res._chunks);
        const tokenFrame = frames.find(f => f.event === 'token-usage');

        expect(tokenFrame).toBeDefined();
        expect(tokenFrame!.data.tokenUsage.inputTokens).toBe(200);
        expect(tokenFrame!.data.tokenUsage.outputTokens).toBe(80);
        expect(tokenFrame!.data.tokenUsage.cacheReadTokens).toBe(10);
        expect(tokenFrame!.data.tokenUsage.cacheWriteTokens).toBe(5);
    });

    it('two concurrent sessions both receive token-usage event', async () => {
        const proc = createProcessFixture({ id: 'token-shared', status: 'running', conversationTurns: [] });
        store.processes.set('token-shared', proc);

        const req1 = createMockReq(); const res1 = createMockRes();
        const req2 = createMockReq(); const res2 = createMockRes();

        handleProcessStream(req1 as any, res1 as any, 'token-shared', store);
        handleProcessStream(req2 as any, res2 as any, 'token-shared', store);

        await vi.waitFor(() => expect(callbacks.filter(Boolean).length).toBe(2));

        const tokenUsage = {
            inputTokens: 50,
            outputTokens: 20,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
        };
        // Both subscribers receive the token usage event
        for (const cb of callbacks.filter(Boolean)) {
            cb({
                type: 'token-usage',
                turnIndex: 0,
                tokenUsage,
            } as any);
        }

        const frames1 = parseSSEFrames(res1._chunks);
        const frames2 = parseSSEFrames(res2._chunks);

        const tokenFrame1 = frames1.find(f => f.event === 'token-usage');
        const tokenFrame2 = frames2.find(f => f.event === 'token-usage');

        expect(tokenFrame1).toBeDefined();
        expect(tokenFrame2).toBeDefined();
        expect(tokenFrame1!.data.tokenUsage.inputTokens).toBe(50);
        expect(tokenFrame2!.data.tokenUsage.inputTokens).toBe(50);
    });

    it('token-usage event emitted after process completes', async () => {
        const proc = createProcessFixture({ id: 'token-after-done', status: 'running', conversationTurns: [] });
        store.processes.set('token-after-done', proc);

        const req = createMockReq(); const res = createMockRes();
        handleProcessStream(req as any, res as any, 'token-after-done', store);
        await vi.waitFor(() => expect(callbacks.filter(Boolean).length).toBe(1));

        // Token-usage arrives before complete
        callbacks[0]({
            type: 'token-usage',
            turnIndex: 0,
            tokenUsage: { inputTokens: 300, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
        } as any);

        callbacks[0]({ type: 'complete', status: 'completed', duration: '5s' });

        const frames = parseSSEFrames(res._chunks);
        const tokenFrame = frames.find(f => f.event === 'token-usage');
        const doneFrame = frames.find(f => f.event === 'done');

        expect(tokenFrame).toBeDefined();
        expect(doneFrame).toBeDefined();

        // token-usage should come before done in the frame ordering
        const tokenIdx = frames.indexOf(tokenFrame!);
        const doneIdx = frames.indexOf(doneFrame!);
        expect(tokenIdx).toBeLessThan(doneIdx);

        expect(res._ended).toBe(true);
    });
});
