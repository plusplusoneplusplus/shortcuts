/**
 * SSE Reconnect-After-Refresh Integration Tests
 *
 * Tests the full page-refresh recovery scenario: a client connects to a running
 * SSE stream, disconnects (simulating a browser refresh), then reconnects —
 * verifying it receives the full conversation snapshot and any turns that arrived
 * between disconnect and reconnect.
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

function parseSSEFrames(chunks: string[]): Array<{ event: string; data: unknown }> {
    const raw = chunks.join('');
    const frames: Array<{ event: string; data: unknown }> = [];
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
// Tests
// ============================================================================

describe('SSE reconnect-after-refresh', () => {
    let store: MockProcessStore;

    beforeEach(() => {
        store = createMockProcessStore();
        store.onProcessOutput = vi.fn(() => () => {});
    });

    it('reconnect after page refresh receives the full conversation snapshot again', async () => {
        const turns = [makeTurn('user', 'First'), makeTurn('assistant', 'Response')];
        const process = createProcessFixture({ id: 'p-refresh', status: 'running', conversationTurns: turns });
        store.processes.set('p-refresh', process);

        // First connection
        const req1 = createMockReq();
        const res1 = createMockRes();
        handleProcessStream(req1 as any, res1 as any, 'p-refresh', store);
        await vi.waitFor(() => expect(res1._chunks.length).toBeGreaterThan(0));
        (req1 as any).emit('close'); // simulate page refresh / tab close

        // Second connection (after refresh)
        const req2 = createMockReq();
        const res2 = createMockRes();
        handleProcessStream(req2 as any, res2 as any, 'p-refresh', store);
        await vi.waitFor(() => expect(res2._chunks.length).toBeGreaterThan(0));

        const frames2 = parseSSEFrames(res2._chunks);
        const snapshot2 = frames2.find(f => f.event === 'conversation-snapshot');
        expect(snapshot2).toBeDefined();
        const data2 = snapshot2!.data as any;
        expect(data2.turns).toHaveLength(2);
        expect(data2.turns[0].content).toBe('First');
        expect(data2.turns[1].content).toBe('Response');
    });

    it('snapshot on reconnect includes turns that arrived between disconnect and reconnect', async () => {
        const process = createProcessFixture({
            id: 'p-newturns',
            status: 'running',
            conversationTurns: [makeTurn('user', 'Q1')],
        });
        store.processes.set('p-newturns', process);

        // First connection — connect and immediately disconnect
        const req1 = createMockReq();
        const res1 = createMockRes();
        handleProcessStream(req1 as any, res1 as any, 'p-newturns', store);
        await vi.waitFor(() => expect(res1._chunks.length).toBeGreaterThan(0));
        (req1 as any).emit('close');

        // Simulate AI replying between connections (store updated)
        process.conversationTurns!.push(makeTurn('assistant', 'A1'));
        process.conversationTurns!.push(makeTurn('user', 'Q2'));

        // Second connection — should see all 3 turns
        const req2 = createMockReq();
        const res2 = createMockRes();
        handleProcessStream(req2 as any, res2 as any, 'p-newturns', store);
        await vi.waitFor(() => expect(res2._chunks.length).toBeGreaterThan(0));

        const frames2 = parseSSEFrames(res2._chunks);
        const snapshot2 = frames2.find(f => f.event === 'conversation-snapshot');
        expect(snapshot2).toBeDefined();
        const data2 = snapshot2!.data as any;
        expect(data2.turns).toHaveLength(3);
        expect(data2.turns[2].content).toBe('Q2');
    });

    it('snapshot on reconnect preserves streaming:true flag on a partial assistant turn', async () => {
        const partialTurn: ConversationTurn = { ...makeTurn('assistant', 'So far...'), streaming: true };
        const process = createProcessFixture({
            id: 'p-partial',
            status: 'running',
            conversationTurns: [makeTurn('user', 'Tell me'), partialTurn],
        });
        store.processes.set('p-partial', process);

        const req1 = createMockReq();
        const res1 = createMockRes();
        handleProcessStream(req1 as any, res1 as any, 'p-partial', store);
        await vi.waitFor(() => expect(res1._chunks.length).toBeGreaterThan(0));
        (req1 as any).emit('close');

        const req2 = createMockReq();
        const res2 = createMockRes();
        handleProcessStream(req2 as any, res2 as any, 'p-partial', store);
        await vi.waitFor(() => expect(res2._chunks.length).toBeGreaterThan(0));

        const frames2 = parseSSEFrames(res2._chunks);
        const snapshot2 = frames2.find(f => f.event === 'conversation-snapshot');
        expect(snapshot2).toBeDefined();
        const data2 = snapshot2!.data as any;
        expect(data2.turns[1].streaming).toBe(true);
        expect(data2.turns[1].content).toBe('So far...');
    });
});
