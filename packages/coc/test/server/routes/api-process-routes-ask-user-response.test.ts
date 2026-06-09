import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../../src/server/shared/router';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { QueueExecutorBridge } from '../../../src/server/core/api-handler';

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

describe('api-process-routes ask-user response', () => {
    let server: http.Server;
    let baseUrl: string;
    let answerAskUserQuestions: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
        const store = createMockProcessStore();
        answerAskUserQuestions = vi.fn().mockResolvedValue(true);
        const bridge: QueueExecutorBridge = {
            executeFollowUp: vi.fn().mockResolvedValue(undefined),
            isSessionAlive: vi.fn().mockResolvedValue(true),
            answerAskUserQuestions,
        };

        const routes: Route[] = [];
        registerApiProcessRoutes({
            routes,
            store,
            bridge,
            dataDir: '/tmp/test-coc',
            gitOpsStore: {} as any,
        });

        server = http.createServer(createRouter({ routes }));
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
        answerAskUserQuestions.mockClear().mockResolvedValue(true);
    });

    it('passes deferred need-more-context answers through to the bridge', async () => {
        const res = await request(baseUrl, '/api/processes/proc-1/ask-user-response', {
            method: 'POST',
            body: JSON.stringify({
                batchId: 'batch-1',
                answers: [
                    { questionId: 'q1', answer: 'ready' },
                    { questionId: 'q2', deferred: true, reason: 'needs-context', note: '  Need the API boundary.  ' },
                ],
            }),
        });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ ok: true });
        expect(answerAskUserQuestions).toHaveBeenCalledWith('proc-1', 'batch-1', [
            { questionId: 'q1', answer: 'ready', skipped: false },
            { questionId: 'q2', skipped: false, deferred: true, reason: 'needs-context', note: 'Need the API boundary.' },
        ]);
    });

    it('rejects malformed deferred answers before resolving the batch', async () => {
        const res = await request(baseUrl, '/api/processes/proc-1/ask-user-response', {
            method: 'POST',
            body: JSON.stringify({
                batchId: 'batch-1',
                answers: [
                    { questionId: 'q1', deferred: true },
                ],
            }),
        });

        expect(res.status).toBe(400);
        expect(answerAskUserQuestions).not.toHaveBeenCalled();
    });
});
