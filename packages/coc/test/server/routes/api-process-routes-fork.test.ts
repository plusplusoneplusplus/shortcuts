/**
 * POST /api/processes/:id/fork — Fork Route Tests
 *
 * Validates process forking via the REST API endpoint, including
 * success path, error cases, and WebSocket event broadcasting.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../../src/server/shared/router';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { MockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Mocks
// ============================================================================

// Stub SSE handler
vi.mock('../../../src/server/streaming/sse-handler', () => ({
    handleProcessStream: vi.fn(),
    emitMessageQueued: vi.fn(),
    emitPendingMessageAdded: vi.fn(),
    emitMessageSteering: vi.fn(),
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

vi.mock('../../../src/server/memory/conversation-recorder', () => ({
    recordUserMessage: vi.fn(),
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

describe('POST /api/processes/:id/fork', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let broadcastSpy: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
        store = createMockProcessStore();

        // Add forkProcess to the mock store
        (store as any).forkProcess = vi.fn().mockImplementation(
            async (sourceId: string, newId: string) => {
                const source = store.processes.get(sourceId);
                if (!source) throw new Error('Source process not found: ' + sourceId);
                const forked = {
                    id: newId,
                    type: source.type,
                    status: 'completed' as const,
                    promptPreview: `[Fork] ${source.promptPreview}`,
                    fullPrompt: source.fullPrompt,
                    startTime: new Date(),
                    endTime: new Date(),
                    sdkSessionId: undefined,
                    activeProviderSession: undefined,
                    title: `[Fork] ${source.title || source.promptPreview}`,
                    metadata: { ...source.metadata, forkSourceId: sourceId },
                    workingDirectory: source.workingDirectory,
                    conversationTurns: (source.conversationTurns || []).map(t => ({
                        ...t,
                        historical: true,
                        streaming: false,
                    })),
                };
                store.processes.set(newId, forked as any);
                return forked;
            },
        );

        broadcastSpy = vi.fn();
        const getWsServer = () => ({
            broadcastProcessEvent: broadcastSpy,
        });

        const routes: Route[] = [];
        registerApiProcessRoutes({
            routes,
            store,
            dataDir: '/tmp/test-coc',
            gitOpsStore: {} as any,
            getWsServer: getWsServer as any,
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
        broadcastSpy.mockClear();
        ((store as any).forkProcess as ReturnType<typeof vi.fn>).mockClear();
    });

    it('returns 404 when process does not exist', async () => {
        const res = await request(baseUrl, '/api/processes/nonexistent/fork', {
            method: 'POST',
            body: '{}',
        });
        expect(res.status).toBe(404);
    });

    it('forks a canonical transcript without a native session', async () => {
        await store.addProcess({
            id: 'no-sdk',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'test',
        });

        const res = await request(baseUrl, '/api/processes/no-sdk/fork', {
            method: 'POST',
            body: '{}',
        });
        expect(res.status).toBe(201);
        expect(res.json().process.sdkSessionId).toBeUndefined();
    });

    it('forks a process and returns 201 with the new process', async () => {
        await store.addProcess({
            id: 'proc-1',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hello world',
            sdkSessionId: 'sdk-123',
            title: 'My Chat',
            metadata: { type: 'chat', workspaceId: 'ws-test' },
            workingDirectory: '/tmp/project',
            conversationTurns: [
                { role: 'user', content: 'Hi', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'Hello!', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ],
        });

        const res = await request(baseUrl, '/api/processes/proc-1/fork', {
            method: 'POST',
            body: '{}',
        });

        expect(res.status).toBe(201);
        const data = res.json();
        expect(data.process).toBeDefined();
        expect(data.process.id).toBeTruthy();
        expect(data.process.sdkSessionId).toBeUndefined();
        expect(data.process.activeProviderSession).toBeUndefined();
        expect(data.process.title).toBe('[Fork] My Chat');
        expect(data.process.metadata.forkSourceId).toBe('proc-1');
        expect((store as any).forkProcess).toHaveBeenCalledWith('proc-1', expect.any(String));
    });

    it('broadcasts process-added WebSocket event on fork', async () => {
        await store.addProcess({
            id: 'proc-ws',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'test',
            sdkSessionId: 'sdk-abc',
            metadata: { type: 'chat', workspaceId: 'ws-broadcast' },
        });

        await request(baseUrl, '/api/processes/proc-ws/fork', {
            method: 'POST',
            body: '{}',
        });

        expect(broadcastSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'process-added',
                process: expect.objectContaining({
                    status: 'completed',
                    workspaceId: 'ws-broadcast',
                }),
            }),
        );
    });
});
