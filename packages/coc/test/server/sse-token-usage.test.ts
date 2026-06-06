/**
 * SSE Token Usage Event Tests
 *
 * Tests that the SSE handler:
 * - Forwards 'token-usage' events as named SSE events
 * - Includes persisted context window totals and breakdown in conversation-snapshot
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConversationTurn, ProcessOutputEvent } from '@plusplusoneplusplus/forge';
import { handleProcessStream } from '../../src/server/streaming/sse-handler';
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
            cumulativeTokenUsage: {
                ...tokenUsage,
                totalTokens: 6912,
                turnCount: 1,
            },
            conversationCostEstimate: {
                estimatedUsdCost: 0.123,
                costBreakdown: { inputUsd: 0.01, cachedInputUsd: 0.001, cacheWriteUsd: 0.002, outputUsd: 0.11 },
                pricingSource: 'Copilot pricing table',
                unpricedTurnCount: 0,
                pricingUnavailable: false,
            },
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
        expect(d.cumulativeTokenUsage).toMatchObject({
            inputTokens: 1234,
            outputTokens: 5678,
            totalTokens: 6912,
        });
        expect(d.conversationCostEstimate).toMatchObject({
            estimatedUsdCost: 0.123,
            pricingUnavailable: false,
        });
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

    it('includes session context totals and breakdown in conversation-snapshot when available on process', async () => {
        const proc = createProcessFixture({
            id: 'p-snap-token',
            status: 'completed',
            conversationTurns: [makeTurn('user', 'Hello', 0)],
            tokenLimit: 200_000,
            currentTokens: 50_000,
            systemTokens: 12_000,
            toolDefinitionsTokens: 24_000,
            conversationTokens: 14_000,
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
        expect(d.sessionSystemTokens).toBe(12_000);
        expect(d.sessionToolTokens).toBe(24_000);
        expect(d.sessionConversationTokens).toBe(14_000);
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
        expect(d.sessionSystemTokens).toBeUndefined();
        expect(d.sessionToolTokens).toBeUndefined();
        expect(d.sessionConversationTokens).toBeUndefined();
    });

    it('conversation-snapshot includes sessionTokenLimit on first connect (seeded value, before AI response)', async () => {
        // Simulates a process that was just created with a seeded tokenLimit from
        // ModelMetadataStore — status is 'running' and no AI response has arrived yet.
        const proc = createProcessFixture({
            id: 'p-snap-seeded',
            status: 'running',
            conversationTurns: [makeTurn('user', 'Hello', 0)],
            tokenLimit: 200_000,
        } as any);
        store.processes.set(proc.id, proc);

        const req = createMockReq();
        const res = createMockRes();
        await handleProcessStream(req, res, 'p-snap-seeded', store);

        const frames = parseSSEFrames(res._chunks);
        const snapshots = frames.filter(f => f.event === 'conversation-snapshot');
        expect(snapshots).toHaveLength(1);
        const d = snapshots[0].data as any;
        expect(typeof d.sessionTokenLimit).toBe('number');
        expect(d.sessionTokenLimit).toBe(200_000);
    });
});
