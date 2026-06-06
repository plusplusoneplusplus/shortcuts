/**
 * Process ID resolution fallback tests.
 *
 * Validates that GET /api/processes/:id (and other routes) correctly resolve
 * processes when the client sends a queue_-prefixed ID but the process was
 * stored with a bare UUID (e.g. forked processes).
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../../src/server/shared/router';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { MockProcessStore } from '../helpers/mock-process-store';
import { estimateCopilotTokenCost } from '@plusplusoneplusplus/forge';
import type { ConversationTurn } from '@plusplusoneplusplus/forge';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@plusplusoneplusplus/forge', async () => {
    const actual = await vi.importActual('@plusplusoneplusplus/forge');
    return {
        ...actual as object,
        sdkServiceRegistry: { getOrThrow: () => ({ forkSession: vi.fn() }) },
    };
});

vi.mock('../../../src/server/streaming/sse-handler', () => ({
    handleProcessStream: vi.fn(),
    emitMessageQueued: vi.fn(),
    emitPendingMessageAdded: vi.fn(),
    emitMessageSteering: vi.fn(),
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
// Tests — queue_ prefix fallback for bare-UUID processes
// ============================================================================

describe('Process ID resolution: queue_ prefix fallback', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore();

        const routes: Route[] = [];
        registerApiProcessRoutes({
            routes,
            store,
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
    });

    // ---------------------------------------------------------------
    // GET /api/processes/:id
    // ---------------------------------------------------------------

    it('GET returns the process when accessed by its exact bare-UUID ID', async () => {
        const bareId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        await store.addProcess({
            id: bareId,
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'bare-uuid process',
        });

        const res = await request(baseUrl, `/api/processes/${bareId}`);
        expect(res.status).toBe(200);
        expect(res.json().process.id).toBe(bareId);
    });

    it('GET returns the process when accessed with queue_ prefix but stored with bare UUID', async () => {
        const bareId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        await store.addProcess({
            id: bareId,
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'forked process',
        });

        // Client sends queue_<bareId> but the process is stored as <bareId>
        const res = await request(baseUrl, `/api/processes/queue_${bareId}`);
        expect(res.status).toBe(200);
        expect(res.json().process.id).toBe(bareId);
    });

    it('GET returns 404 when neither queue_<id> nor bare <id> exist', async () => {
        const res = await request(baseUrl, '/api/processes/queue_nonexistent');
        expect(res.status).toBe(404);
    });

    it('GET returns the process normally when accessed by its queue_ ID', async () => {
        const queueId = 'queue_1234567890-abc';
        await store.addProcess({
            id: queueId,
            type: 'chat',
            status: 'running',
            startTime: new Date(),
            promptPreview: 'queue-created process',
        });

        const res = await request(baseUrl, `/api/processes/${encodeURIComponent(queueId)}`);
        expect(res.status).toBe(200);
        expect(res.json().process.id).toBe(queueId);
    });

    it('GET exposes a derived per-turn conversation cost estimate without storing it', async () => {
        const firstUsage = {
            inputTokens: 1_000_000,
            outputTokens: 100_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 1_100_000,
            turnCount: 1,
        };
        const secondUsage = {
            inputTokens: 1_000_000,
            outputTokens: 100_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 1_100_000,
            turnCount: 1,
        };
        const turns: ConversationTurn[] = [
            { role: 'user', content: 'first', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'first answer', timestamp: new Date(), turnIndex: 1, timeline: [], tokenUsage: firstUsage },
            { role: 'user', content: 'switch', timestamp: new Date(), turnIndex: 2, timeline: [], model: 'gpt-5-mini' },
            { role: 'assistant', content: 'second answer', timestamp: new Date(), turnIndex: 3, timeline: [], tokenUsage: secondUsage },
        ];
        await store.addProcess({
            id: 'priced-process',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'priced',
            metadata: { type: 'chat', model: 'gpt-5.5' },
            cumulativeTokenUsage: {
                inputTokens: 2_000_000,
                outputTokens: 200_000,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 2_200_000,
                turnCount: 2,
            },
            conversationTurns: turns,
        });

        const res = await request(baseUrl, '/api/processes/priced-process');
        expect(res.status, res.body).toBe(200);
        const process = res.json().process;
        const expected = estimateCopilotTokenCost('gpt-5.5', firstUsage)!.totalUsd
            + estimateCopilotTokenCost('gpt-5-mini', secondUsage)!.totalUsd;
        expect(process.conversationCostEstimate.estimatedUsdCost).toBeCloseTo(expected);
        expect(process.conversationCostEstimate.unpricedTurnCount).toBe(0);
        expect(process.conversationCostEstimate.pricingUnavailable).toBe(false);
        expect(store.processes.get('priced-process')!.conversationCostEstimate).toBeUndefined();
    });

    // ---------------------------------------------------------------
    // PATCH /api/processes/:id
    // ---------------------------------------------------------------

    it('PATCH updates the process when accessed with queue_ prefix but stored with bare UUID', async () => {
        const bareId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        await store.addProcess({
            id: bareId,
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'test',
        });

        const res = await request(baseUrl, `/api/processes/queue_${bareId}`, {
            method: 'PATCH',
            body: JSON.stringify({ customTitle: 'Updated Title' }),
        });
        expect(res.status).toBe(200);
        expect(res.json().process.customTitle).toBe('Updated Title');
    });

    // ---------------------------------------------------------------
    // DELETE /api/processes/:id
    // ---------------------------------------------------------------

    it('DELETE removes the process when accessed with queue_ prefix but stored with bare UUID', async () => {
        const bareId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        await store.addProcess({
            id: bareId,
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'test',
        });

        const res = await request(baseUrl, `/api/processes/queue_${bareId}`, { method: 'DELETE' });
        expect(res.status).toBe(204);

        // Verify process is gone
        const check = await request(baseUrl, `/api/processes/${bareId}`);
        expect(check.status).toBe(404);
    });

    // ---------------------------------------------------------------
    // GET /api/processes/:id/output
    // ---------------------------------------------------------------

    it('GET /output returns 404 with queue_ prefix when process has no output', async () => {
        const bareId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        await store.addProcess({
            id: bareId,
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'test',
        });

        // The process exists but has no rawStdoutFilePath → "Conversation output" not found
        const res = await request(baseUrl, `/api/processes/queue_${bareId}/output`);
        expect(res.status).toBe(404);
        expect(res.json().error).toContain('output');
    });
});
