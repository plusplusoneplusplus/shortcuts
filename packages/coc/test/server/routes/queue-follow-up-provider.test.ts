/**
 * Tests that the cold-resume path in POST /api/queue/:id/resume-chat
 * inherits `payload.provider` from the original task so the dot indicator
 * in the chat list shows the correct provider colour.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../../src/server/shared/router';
import { registerQueueFollowUpRoutes } from '../../../src/server/routes/queue-follow-up';
import type { Route } from '../../../src/server/types';
import type { QueueRouteContext } from '../../../src/server/routes/queue-shared';

// ============================================================================
// HTTP helpers
// ============================================================================

function post(
    baseUrl: string,
    urlPath: string,
    body?: unknown,
): Promise<{ status: number; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const bodyStr = body !== undefined ? JSON.stringify(body) : '';
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode ?? 0, json: () => JSON.parse(text) });
                });
            },
        );
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

// ============================================================================
// describe
// ============================================================================

describe('queue-follow-up cold resume: provider propagation', () => {
    let server: http.Server;
    let baseUrl: string;
    let mockEnqueue: ReturnType<typeof vi.fn>;
    let dataDir: string;

    const makeConvTurns = () => [
        { role: 'user', content: 'Hi', timestamp: new Date(), turnIndex: 0, timeline: [] },
        { role: 'assistant', content: 'Hello', timestamp: new Date(), turnIndex: 1, timeline: [] },
    ];

    beforeAll(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'follow-up-provider-test-'));
        mockEnqueue = vi.fn().mockResolvedValue('new-task-id-1');

        // Build a mock bridge that forces the cold path:
        //   isSessionAlive → false   (skip warm path)
        //   isAIAvailable  → true    (proceed to cold path)
        //   findManagerForTask → returns mock manager with a task containing provider: 'claude'
        //   enqueue → captured by mockEnqueue
        const mockTask = {
            id: 'task-claude-1',
            processId: 'queue_task-claude-1',
            type: 'chat',
            status: 'completed',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                provider: 'claude',
                workingDirectory: dataDir,
                workspaceId: 'ws-test',
                prompt: 'Hello',
            },
            config: {},
            displayName: 'Claude Chat',
        };

        const mockManager = {
            getTask: vi.fn().mockReturnValue(mockTask),
        };

        const mockQueueManager = {
            enqueue: mockEnqueue,
            getStats: vi.fn().mockReturnValue({ isPaused: false, isAutopilotPaused: false }),
        };

        const mockBridge = {
            findManagerForTask: vi.fn().mockReturnValue(mockManager),
            isSessionAlive: vi.fn().mockResolvedValue(false),
            isAIAvailable: vi.fn().mockResolvedValue(true),
            enqueue: mockEnqueue,
            // required by enqueueViaBridge
            getOrCreateBridge: vi.fn(),
            getRepoIdForPath: vi.fn().mockReturnValue('repo-test'),
            registry: {
                getQueueForRepo: vi.fn().mockReturnValue(mockQueueManager),
            },
        };

        const mockStore = {
            getProcess: vi.fn().mockResolvedValue({
                id: 'queue_task-claude-1',
                type: 'chat',
                status: 'completed',
                startTime: new Date(),
                conversationTurns: makeConvTurns(),
            }),
            updateProcess: vi.fn().mockResolvedValue(undefined),
        };

        const ctx: QueueRouteContext = {
            bridge: mockBridge as any,
            store: mockStore as any,
            globalWorkspaceRootPath: dataDir,
            state: {
                globalPaused: false,
                globalAutopilotPaused: false,
                resumeInProgress: new Set(),
            },
        };

        const routes: Route[] = [];
        registerQueueFollowUpRoutes(routes, ctx);

        const router = createRouter({ routes, spaHtml: '' });
        server = http.createServer(router);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('cold resume creates new task with provider inherited from parent', async () => {
        const res = await post(baseUrl, '/api/queue/task-claude-1/resume-chat');

        expect(res.status).toBe(200);
        const body = res.json();
        // Cold path — resumed === false and a new task was created
        expect(body.resumed).toBe(false);
        expect(body.newTaskId).toBe('new-task-id-1');

        // Verify enqueue was called with provider: 'claude' in payload
        expect(mockEnqueue).toHaveBeenCalledOnce();
        const enqueuedInput = mockEnqueue.mock.calls[0][0];
        expect(enqueuedInput.payload.provider).toBe('claude');
    });

    it('cold resume without a provider does not set provider on new task', async () => {
        // Task without provider
        const taskNoProvider = {
            id: 'task-no-provider',
            processId: 'queue_task-no-provider',
            type: 'chat',
            status: 'completed',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                workingDirectory: dataDir,
                workspaceId: 'ws-test',
                prompt: 'Hello',
            },
            config: {},
            displayName: 'Default Chat',
        };

        const mockManager2 = { getTask: vi.fn().mockReturnValue(taskNoProvider) };
        const mockStore2 = {
            getProcess: vi.fn().mockResolvedValue({
                id: 'queue_task-no-provider',
                type: 'chat',
                status: 'completed',
                startTime: new Date(),
                conversationTurns: makeConvTurns(),
            }),
            updateProcess: vi.fn().mockResolvedValue(undefined),
        };
        const mockEnqueue2 = vi.fn().mockResolvedValue('new-task-id-2');
        const mockQueueManager2 = {
            enqueue: mockEnqueue2,
            getStats: vi.fn().mockReturnValue({ isPaused: false, isAutopilotPaused: false }),
        };
        const mockBridge2 = {
            findManagerForTask: vi.fn().mockReturnValue(mockManager2),
            isSessionAlive: vi.fn().mockResolvedValue(false),
            isAIAvailable: vi.fn().mockResolvedValue(true),
            enqueue: mockEnqueue2,
            getOrCreateBridge: vi.fn(),
            getRepoIdForPath: vi.fn().mockReturnValue('repo-test'),
            registry: {
                getQueueForRepo: vi.fn().mockReturnValue(mockQueueManager2),
            },
        };
        const ctx2: QueueRouteContext = {
            bridge: mockBridge2 as any,
            store: mockStore2 as any,
            globalWorkspaceRootPath: dataDir,
            state: {
                globalPaused: false,
                globalAutopilotPaused: false,
                resumeInProgress: new Set(),
            },
        };

        const routes2: Route[] = [];
        registerQueueFollowUpRoutes(routes2, ctx2);
        const router2 = createRouter({ routes: routes2, spaHtml: '' });
        const server2 = http.createServer(router2);
        await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', () => resolve()));
        const addr2 = server2.address() as { port: number };
        const baseUrl2 = `http://127.0.0.1:${addr2.port}`;

        try {
            const res = await post(baseUrl2, '/api/queue/task-no-provider/resume-chat');
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.resumed).toBe(false);

            const enqueuedInput = mockEnqueue2.mock.calls[0][0];
            expect(enqueuedInput.payload.provider).toBeUndefined();
        } finally {
            await new Promise<void>((resolve) => server2.close(() => resolve()));
        }
    });
});
