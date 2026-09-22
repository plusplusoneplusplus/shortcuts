/**
 * Regression: a follow-up sent to a sentinel chat used to demote it.
 *
 * The composer rendered Ask as selected and POSTed `mode: 'ask'`, which the
 * route forwarded verbatim — so the turn ran as Ask and FollowUpExecutor
 * rewrote `metadata.mode` to 'ask', unhooking the conversation from cron
 * routing and workspace ownership (both key off `metadata.mode === 'sentinel'`).
 *
 * The route now resolves the mode through `resolveFollowUpMode`, which refuses
 * to switch away from a terminal conversation mode.
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

vi.mock('../../../src/server/memory/conversation-recorder', () => ({
    recordUserMessage: vi.fn(),
}));

vi.mock('../../../src/server/core/attachment-utils', () => ({
    processMessageAttachments: vi.fn().mockReturnValue({
        sdkAttachments: [],
        validatedImages: undefined,
        fileAttachmentMeta: undefined,
        textContext: undefined,
    }),
    hasAttachments: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/server/core/image-utils', () => ({
    saveImagesToTempFiles: vi.fn(),
    cleanupTempDir: vi.fn(),
    isImageDataUrl: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/server/streaming/sse-handler', () => ({
    handleProcessStream: vi.fn(),
    emitMessageQueued: vi.fn(),
    emitPendingMessageAdded: vi.fn(),
    emitMessageSteering: vi.fn(),
}));

function request(
    baseUrl: string,
    urlPath: string,
    options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode || 0, body: bodyStr, json: () => JSON.parse(bodyStr) });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

describe('api-process-routes follow-up mode — terminal sentinel mode', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let enqueueMock: ReturnType<typeof vi.fn>;
    let findTaskByProcessIdMock: ReturnType<typeof vi.fn>;

    async function addChat(id: string, mode: string) {
        await store.addProcess({
            id,
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'initial',
            workingDirectory: '/home/user/project',
            metadata: { type: 'chat', workspaceId: 'ws-1', mode },
            conversationTurns: [
                { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            ],
        } as any);
    }

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
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
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

    it('runs a sentinel chat follow-up as sentinel even when the client asks for ask', async () => {
        await addChat('proc-sentinel', 'sentinel');

        const res = await request(baseUrl, '/api/processes/proc-sentinel/message', {
            method: 'POST',
            body: JSON.stringify({ content: 'check again', mode: 'ask' }),
        });

        expect(res.status).toBe(202);
        expect(enqueueMock).toHaveBeenCalledTimes(1);
        const input: CreateTaskInput = enqueueMock.mock.calls[0][0];
        expect(input.payload.mode).toBe('sentinel');
        expect((await store.getProcess('proc-sentinel'))?.metadata?.mode).toBe('sentinel');
    });

    it('keeps sentinel when the follow-up is buffered as a pending message', async () => {
        findTaskByProcessIdMock.mockReturnValue({ status: 'running' });
        await addChat('proc-sentinel-busy', 'sentinel');

        await request(baseUrl, '/api/processes/proc-sentinel-busy/message', {
            method: 'POST',
            body: JSON.stringify({ content: 'queued while busy', mode: 'autopilot' }),
        });

        const pending = (await store.getProcess('proc-sentinel-busy'))?.pendingMessages ?? [];
        expect(pending).toHaveLength(1);
        expect(pending[0].mode).toBe('sentinel');
    });

    it('still honours an explicit mode switch on an ordinary chat', async () => {
        await addChat('proc-ask', 'ask');

        await request(baseUrl, '/api/processes/proc-ask/message', {
            method: 'POST',
            body: JSON.stringify({ content: 'go build it', mode: 'autopilot' }),
        });

        expect(enqueueMock).toHaveBeenCalledTimes(1);
        const input: CreateTaskInput = enqueueMock.mock.calls[0][0];
        expect(input.payload.mode).toBe('autopilot');
    });

    it('populates the mode from the process when the client sends none', async () => {
        await addChat('proc-inherit', 'autopilot');

        await request(baseUrl, '/api/processes/proc-inherit/message', {
            method: 'POST',
            body: JSON.stringify({ content: 'continue' }),
        });

        const input: CreateTaskInput = enqueueMock.mock.calls[0][0];
        expect(input.payload.mode).toBe('autopilot');
    });

    it('restores the dropped ralph mode so the executor never sees a missing mode', async () => {
        await addChat('proc-ralph', 'ralph');

        await request(baseUrl, '/api/processes/proc-ralph/message', {
            method: 'POST',
            body: JSON.stringify({ content: 'keep going', mode: 'ralph' }),
        });

        const input: CreateTaskInput = enqueueMock.mock.calls[0][0];
        expect(input.payload.mode).toBe('ralph');
    });
});
