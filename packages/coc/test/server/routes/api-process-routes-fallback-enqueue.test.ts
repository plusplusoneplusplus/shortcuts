/**
 * Fallback Enqueue Path — workspaceId Propagation Test
 *
 * Verifies that when a follow-up message falls through to the fallback enqueue
 * path (no parent task found), the workspaceId is propagated from process metadata
 * into the new task payload so ChatExecutor can inject work item tools.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../../src/server/shared/router';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { MockProcessStore } from '../helpers/mock-process-store';
import type { QueueExecutorBridge } from '../../../src/server/core/api-handler';
import type { CreateTaskInput } from '@plusplusoneplusplus/forge';

// ============================================================================
// Mocks
// ============================================================================

// Prevent real memory recording
vi.mock('../../../src/server/memory/conversation-recorder', () => ({
    recordUserMessage: vi.fn(),
}));

// Stub attachment processing
vi.mock('../../../src/server/core/attachment-utils', () => ({
    processMessageAttachments: vi.fn().mockReturnValue({
        sdkAttachments: [],
        validatedImages: undefined,
        fileAttachmentMeta: undefined,
        textContext: undefined,
    }),
    hasAttachments: vi.fn().mockReturnValue(false),
}));

// Stub image utils
vi.mock('../../../src/server/core/image-utils', () => ({
    saveImagesToTempFiles: vi.fn(),
    cleanupTempDir: vi.fn(),
    isImageDataUrl: vi.fn().mockReturnValue(false),
}));

// Stub SSE handler
vi.mock('../../../src/server/streaming/sse-handler', () => ({
    handleProcessStream: vi.fn(),
    emitMessageQueued: vi.fn(),
    emitPendingMessageAdded: vi.fn(),
    emitMessageSteering: vi.fn(),
}));

// ============================================================================
// Helpers
// ============================================================================

function request(
    baseUrl: string,
    urlPath: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: bodyStr,
                        json: () => JSON.parse(bodyStr),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('api-process-routes fallback enqueue — workspaceId propagation', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let enqueueMock: ReturnType<typeof vi.fn>;
    let findTaskByProcessIdMock: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
        store = createMockProcessStore();
        enqueueMock = vi.fn().mockResolvedValue('new-task-id');
        findTaskByProcessIdMock = vi.fn();

        const bridge: QueueExecutorBridge = {
            executeFollowUp: vi.fn().mockResolvedValue(undefined),
            isSessionAlive: vi.fn().mockResolvedValue(true),
            enqueue: enqueueMock,
            findTaskByProcessId: findTaskByProcessIdMock,
        };

        const routes: Route[] = [];
        registerApiProcessRoutes({
            routes,
            store,
            bridge,
            dataDir: '/tmp/test-coc',
            gitOpsStore: {} as any,
        });

        const router = createRouter({ routes });
        server = http.createServer(router);

        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve());
        });

        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
        store.processes.clear();
        enqueueMock.mockClear();
        findTaskByProcessIdMock.mockReset().mockReturnValue(undefined);
    });

    it('propagates workspaceId from process metadata in fallback enqueue payload', async () => {
        await store.addProcess({
            id: 'proc-ws',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'initial',
            workingDirectory: '/home/user/project',
            metadata: { type: 'chat', workspaceId: 'ws-abc-123' },
            conversationTurns: [
                { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            ],
        });

        await request(baseUrl, '/api/processes/proc-ws/message', {
            method: 'POST',
            body: JSON.stringify({ content: 'create a work item' }),
        });

        expect(enqueueMock).toHaveBeenCalledTimes(1);
        const input: CreateTaskInput = enqueueMock.mock.calls[0][0];
        expect(input.payload).toEqual(
            expect.objectContaining({
                workspaceId: 'ws-abc-123',
                workingDirectory: '/home/user/project',
            }),
        );
    });

    it('passes undefined workspaceId when process has no metadata', async () => {
        await store.addProcess({
            id: 'proc-no-meta',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'initial',
            conversationTurns: [
                { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            ],
        });

        await request(baseUrl, '/api/processes/proc-no-meta/message', {
            method: 'POST',
            body: JSON.stringify({ content: 'just a message' }),
        });

        expect(enqueueMock).toHaveBeenCalledTimes(1);
        const input: CreateTaskInput = enqueueMock.mock.calls[0][0];
        expect(input.payload.workspaceId).toBeUndefined();
    });

    it('drops invalid model overrides but preserves valid reasoning effort in fallback enqueue payloads', async () => {
        await store.addProcess({
            id: 'proc-claude-invalid-model',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'initial',
            metadata: { type: 'chat', provider: 'claude', model: 'haiku' },
            conversationTurns: [
                { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            ],
        });

        const res = await request(baseUrl, '/api/processes/proc-claude-invalid-model/message', {
            method: 'POST',
            body: JSON.stringify({ content: 'continue', model: 'gpt-5.5', reasoningEffort: 'high' }),
        });

        expect(res.status).toBe(202);
        expect(enqueueMock).toHaveBeenCalledTimes(1);
        const input: CreateTaskInput = enqueueMock.mock.calls[0][0];
        expect(input.payload.model).toBeUndefined();
        expect(input.payload.reasoningEffort).toBe('high');
        expect(input.config).toEqual({ reasoningEffort: 'high' });
    });

    it('buffers pending messages with dropped invalid model overrides and preserved effort', async () => {
        findTaskByProcessIdMock.mockReturnValue({ status: 'running' });
        await store.addProcess({
            id: 'proc-claude-running',
            type: 'chat',
            status: 'running',
            startTime: new Date(),
            promptPreview: 'initial',
            metadata: { type: 'chat', provider: 'claude', model: 'haiku' },
            conversationTurns: [
                { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            ],
        });

        const res = await request(baseUrl, '/api/processes/proc-claude-running/message', {
            method: 'POST',
            body: JSON.stringify({ content: 'queued follow-up', model: 'gpt-5.5', reasoningEffort: 'high' }),
        });

        expect(res.status).toBe(202);
        expect(enqueueMock).not.toHaveBeenCalled();
        const pendingMessage = store.processes.get('proc-claude-running')?.pendingMessages?.[0] as any;
        expect(pendingMessage).toEqual(expect.objectContaining({
            content: 'queued follow-up',
            displayContent: 'queued follow-up',
            reasoningEffort: 'high',
        }));
        expect(pendingMessage.model).toBeUndefined();
    });
});
