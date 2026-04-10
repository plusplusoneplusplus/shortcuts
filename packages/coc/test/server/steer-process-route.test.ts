/**
 * Steering Route Tests
 *
 * Verifies that POST /api/processes/:id/message routes to steerProcess()
 * when the parent task is running and deliveryMode is 'immediate', instead
 * of creating a duplicate queue task via enqueue().
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/api-handler';
import type { QueueExecutorBridge } from '../../src/server/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore, createCompletedProcessWithSession, createProcessFixture } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Test Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
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
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('POST /api/processes/:id/message — steer running task', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let bridge: QueueExecutorBridge;
    let steerProcessMock: ReturnType<typeof vi.fn>;
    let enqueueMock: ReturnType<typeof vi.fn>;
    let findTaskMock: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
        store = createMockProcessStore({
            initialProcesses: [
                createProcessFixture({
                    id: 'proc-running',
                    status: 'running',
                    sdkSessionId: 'sdk-sess-1',
                    conversationTurns: [
                        { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0, timeline: [] },
                        { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1, timeline: [] },
                    ],
                }),
                createCompletedProcessWithSession('proc-completed', 'sdk-sess-2'),
            ],
        });

        steerProcessMock = vi.fn().mockResolvedValue(true);
        enqueueMock = vi.fn().mockResolvedValue('mock-task-id');
        findTaskMock = vi.fn();

        bridge = {
            executeFollowUp: vi.fn(async () => {}),
            isSessionAlive: vi.fn(async () => true),
            enqueue: enqueueMock,
            findTaskByProcessId: findTaskMock,
            requeueForFollowUp: vi.fn(async () => {}),
            cancelProcess: vi.fn(async () => {}),
            steerProcess: steerProcessMock,
        };

        const routes: Route[] = [];
        registerApiRoutes(routes, store, bridge);

        const handler = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handler);
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
        // Reset mocks between tests
        steerProcessMock.mockClear().mockResolvedValue(true);
        enqueueMock.mockClear().mockResolvedValue('mock-task-id');
        findTaskMock.mockClear();
        vi.mocked(bridge.executeFollowUp).mockClear();
        vi.mocked(store.emitProcessEvent).mockClear();

        // Reset process states
        store.processes.set('proc-running', createProcessFixture({
            id: 'proc-running',
            status: 'running',
            sdkSessionId: 'sdk-sess-1',
            conversationTurns: [
                { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ],
        }));
        store.processes.set('proc-completed', createCompletedProcessWithSession('proc-completed', 'sdk-sess-2'));
    });

    it('steers a running task instead of creating a new queue task', async () => {
        findTaskMock.mockReturnValue({ id: 'task-1', type: 'chat', status: 'running' });

        const resp = await request(`${baseUrl}/api/processes/proc-running/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'steer this', deliveryMode: 'immediate' }),
        });

        expect(resp.status).toBe(202);
        expect(steerProcessMock).toHaveBeenCalledWith('proc-running', 'steer this');
        expect(enqueueMock).not.toHaveBeenCalled();
    });

    it('falls back to enqueue when steerProcess returns false', async () => {
        findTaskMock.mockReturnValue({ id: 'task-1', type: 'chat', status: 'running' });
        steerProcessMock.mockResolvedValue(false);

        const resp = await request(`${baseUrl}/api/processes/proc-running/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'fallback msg', deliveryMode: 'immediate' }),
        });

        expect(resp.status).toBe(202);
        expect(steerProcessMock).toHaveBeenCalledOnce();
        expect(enqueueMock).toHaveBeenCalledOnce();
    });

    it('enqueues normally when deliveryMode is enqueue even if task is running', async () => {
        findTaskMock.mockReturnValue({ id: 'task-1', type: 'chat', status: 'running' });

        const resp = await request(`${baseUrl}/api/processes/proc-running/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'queue me', deliveryMode: 'enqueue' }),
        });

        expect(resp.status).toBe(202);
        expect(steerProcessMock).not.toHaveBeenCalled();
        expect(enqueueMock).toHaveBeenCalledOnce();
    });

    it('enqueues normally when no parent task is found', async () => {
        findTaskMock.mockReturnValue(undefined);

        const resp = await request(`${baseUrl}/api/processes/proc-running/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'no parent', deliveryMode: 'immediate' }),
        });

        expect(resp.status).toBe(202);
        expect(steerProcessMock).not.toHaveBeenCalled();
        expect(enqueueMock).toHaveBeenCalledOnce();
    });

    it('requeues completed tasks normally (unchanged behavior)', async () => {
        findTaskMock.mockReturnValue({ id: 'task-2', type: 'chat', status: 'completed' });

        const resp = await request(`${baseUrl}/api/processes/proc-completed/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'follow up', deliveryMode: 'immediate' }),
        });

        expect(resp.status).toBe(202);
        expect(steerProcessMock).not.toHaveBeenCalled();
        expect(bridge.requeueForFollowUp).toHaveBeenCalledOnce();
    });

    it('emits message-queued SSE event after successful steer', async () => {
        findTaskMock.mockReturnValue({ id: 'task-1', type: 'chat', status: 'running' });

        await request(`${baseUrl}/api/processes/proc-running/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'steer msg' , deliveryMode: 'immediate' }),
        });

        const emitCalls = vi.mocked(store.emitProcessEvent).mock.calls;
        const mqEvent = emitCalls.find(([, evt]) => (evt as any).type === 'message-queued');
        expect(mqEvent).toBeDefined();
        expect((mqEvent![1] as any).deliveryMode).toBe('immediate');
        expect((mqEvent![1] as any).queuePosition).toBe(0);
    });
});
