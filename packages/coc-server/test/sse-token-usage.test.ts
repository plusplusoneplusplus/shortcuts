/**
 * SSE Token Usage Event Tests
 *
 * Tests that the SSE handler:
 * - Forwards 'token-usage' events as named SSE events
 * - Includes sessionTokenLimit and sessionCurrentTokens in conversation-snapshot
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConversationTurn, ProcessOutputEvent } from '@plusplusoneplusplus/pipeline-core';
import { handleProcessStream } from '../src/sse-handler';
import { createMockProcessStore, createProcessFixture } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Helpers (duplicated from sse-replay.test.ts for isolation)
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
        end: vi.fn((body?: string) => { if (body) { chunks.push(body); } ended = true; res._ended = true; }),
    };
    return res as unknown as ServerResponse & { _chunks: string[]; _ended: boolean; _statusCode: number };
}

function makeTurn(role: 'user' | 'assistant', content: string, turnIndex: number): ConversationTurn {
    return { role, content, timestamp: new Date('2026-01-01T00:00:00Z'), turnIndex, timeline: [] };
}

// ============================================================================
// Tests
// ============================================================================

describe('SSE token-usage events', () => {
    let store: MockProcessStore;

    beforeEach(() => {
        store = createMockProcessStore();
    });

    it('forwards token-usage event as SSE with tokenUsage, sessionTokenLimit, sessionCurrentTokens', async () => {
        let outputCallback: ((event: ProcessOutputEvent) => void) | undefined;
        store.onProcessOutput = vi.fn((_id, cb) => {
            outputCallback = cb;
            return () => { outputCallback = undefined; };
        });

        const proc = createProcessFixture({
            id: 'p-token',
            status: 'running',
            conversationTurns: [makeTurn('user', 'Hello', 0)],
        });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'p-token', store);

        const tokenUsage = {
            inputTokens: 1234,
            outputTokens: 5678,
            cacheReadTokens: 100,
            cacheWriteTokens: 50,
            totalTokens: 6912,
            turnCount: 1,
        };
        outputCallback!({
            type: 'token-usage',
            turnIndex: 1,
            tokenUsage,
            sessionTokenLimit: 200_000,
            sessionCurrentTokens: 42_000,
        });

        const frames = parseSSEFrames(res._chunks);
        const tokenFrames = frames.filter(f => f.event === 'token-usage');
        expect(tokenFrames).toHaveLength(1);
        const d = tokenFrames[0].data as any;
        expect(d.turnIndex).toBe(1);
        expect(d.tokenUsage).toMatchObject({
            inputTokens: 1234,
            outputTokens: 5678,
            totalTokens: 6912,
        });
        expect(d.sessionTokenLimit).toBe(200_000);
        expect(d.sessionCurrentTokens).toBe(42_000);
    });

    it('forwards token-usage event without session fields when omitted', async () => {
        let outputCallback: ((event: ProcessOutputEvent) => void) | undefined;
        store.onProcessOutput = vi.fn((_id, cb) => {
            outputCallback = cb;
            return () => { outputCallback = undefined; };
        });

        const proc = createProcessFixture({ id: 'p-token2', status: 'running', conversationTurns: [] });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'p-token2', store);

        outputCallback!({
            type: 'token-usage',
            turnIndex: 0,
            tokenUsage: {
                inputTokens: 10,
                outputTokens: 20,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 30,
                turnCount: 1,
            },
        });

        const frames = parseSSEFrames(res._chunks);
        const tokenFrames = frames.filter(f => f.event === 'token-usage');
        expect(tokenFrames).toHaveLength(1);
        const d = tokenFrames[0].data as any;
        expect(d.turnIndex).toBe(0);
        expect(d.sessionTokenLimit).toBeUndefined();
        expect(d.sessionCurrentTokens).toBeUndefined();
    });

    it('includes sessionTokenLimit and sessionCurrentTokens in conversation-snapshot when available on process', async () => {
        const proc = createProcessFixture({
            id: 'p-snap-token',
            status: 'completed',
            conversationTurns: [makeTurn('user', 'Hello', 0)],
            tokenLimit: 200_000,
            currentTokens: 50_000,
        } as any);
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'p-snap-token', store);

        const frames = parseSSEFrames(res._chunks);
        const snapshots = frames.filter(f => f.event === 'conversation-snapshot');
        expect(snapshots).toHaveLength(1);
        const d = snapshots[0].data as any;
        expect(d.turns).toHaveLength(1);
        expect(d.sessionTokenLimit).toBe(200_000);
        expect(d.sessionCurrentTokens).toBe(50_000);
    });

    it('conversation-snapshot omits token fields when not set on process', async () => {
        const proc = createProcessFixture({
            id: 'p-snap-no-token',
            status: 'completed',
            conversationTurns: [makeTurn('user', 'Hello', 0)],
        });
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'p-snap-no-token', store);

        const frames = parseSSEFrames(res._chunks);
        const snapshots = frames.filter(f => f.event === 'conversation-snapshot');
        expect(snapshots).toHaveLength(1);
        const d = snapshots[0].data as any;
        expect(d.sessionTokenLimit).toBeUndefined();
        expect(d.sessionCurrentTokens).toBeUndefined();
    });
});
