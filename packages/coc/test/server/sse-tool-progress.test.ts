/**
 * Verifies the provider-neutral `tool-progress` SSE contract: the live named
 * event carries the tool-call id and latest message, and a reconnect replays a
 * running call with its latest progress message from the persisted snapshot.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProcessOutputEvent } from '@plusplusoneplusplus/forge';
import { handleProcessStream } from '../../src/server/streaming/sse-handler';
import { BackgroundTasksRegistry } from '../../src/server/streaming/background-tasks-registry';
import type { WarmStatusBridge } from '../../src/server/streaming/warm-status-bridge';
import { parseSSEFrames } from '../helpers/sse-test-utils';
import { createMockProcessStore, createProcessFixture } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

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

function createNoopBridge(): WarmStatusBridge {
    return {
        register: vi.fn(() => vi.fn()),
        getCurrentStatus: vi.fn(() => 'cold'),
    } as unknown as WarmStatusBridge;
}

describe('SSE tool-progress event', () => {
    let store: MockProcessStore;
    let emit: ((event: ProcessOutputEvent) => void) | undefined;

    beforeEach(() => {
        store = createMockProcessStore();
        emit = undefined;
        store.onProcessOutput = vi.fn((_id: string, cb: (event: ProcessOutputEvent) => void) => {
            emit = cb;
            return () => { emit = undefined; };
        });
    });

    it('serializes a live tool-progress event with its tool-call id and message', async () => {
        store.processes.set('p-prog', createProcessFixture({ id: 'p-prog', status: 'running' }));
        const res = createMockRes();
        await handleProcessStream(createMockReq(), res, 'p-prog', store, createNoopBridge(), new BackgroundTasksRegistry());

        emit!({
            type: 'tool-progress',
            toolCallId: 'tc-1',
            toolName: 'read_batch',
            parentToolCallId: 'task-1',
            progressMessage: 'Reading 28 files…',
        });

        const frames = parseSSEFrames(res._chunks).filter(f => f.event === 'tool-progress');
        expect(frames).toHaveLength(1);
        expect(frames[0].data).toEqual({
            toolCallId: 'tc-1',
            parentToolCallId: 'task-1',
            toolName: 'read_batch',
            progressMessage: 'Reading 28 files…',
        });
    });

    it('restores a running call and its latest progress message on reconnect', async () => {
        store.processes.set('p-prog-2', createProcessFixture({
            id: 'p-prog-2',
            status: 'running',
            conversationTurns: [
                { role: 'user', content: 'read these', timestamp: new Date(), turnIndex: 0, timeline: [] },
                {
                    role: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    turnIndex: 1,
                    streaming: true,
                    timeline: [{
                        type: 'tool-start',
                        timestamp: new Date(),
                        toolCall: {
                            id: 'tc-1',
                            name: 'read_batch',
                            status: 'running',
                            startTime: new Date(),
                            args: { paths: ['/a', '/b'] },
                            progressMessage: 'Reading 28 files…',
                        },
                    }],
                },
            ],
        }));

        const res = createMockRes();
        await handleProcessStream(createMockReq(), res, 'p-prog-2', store, createNoopBridge(), new BackgroundTasksRegistry());

        const snapshot = parseSSEFrames(res._chunks).find(f => f.event === 'conversation-snapshot');
        const toolCall = (snapshot!.data as any).turns[1].timeline[0].toolCall;
        expect(toolCall.status).toBe('running');
        expect(toolCall.progressMessage).toBe('Reading 28 files…');
    });
});
