/**
 * POST /api/processes/:id/prewarm — Prewarm Route Tests (AC-04)
 *
 * Validates the workspace-scoped prewarm endpoint: it warms the conversation's
 * provider client without creating a session, picks the provider from the
 * process record (defaulting to copilot), no-ops transparently for providers
 * that can't stay warm (Claude), and never surfaces a warm-start failure as an
 * error.
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

const mockPrewarm = vi.fn();
// Mutable provider→service map consulted by the mocked sdkServiceRegistry.get.
// Populated per-test in beforeEach (the mock factory captures the binding).
const providerServices: Record<string, any> = {};

vi.mock('@plusplusoneplusplus/forge', async () => {
    const actual = await vi.importActual('@plusplusoneplusplus/forge');
    return {
        ...actual as object,
        sdkServiceRegistry: { get: (name: string) => providerServices[name] },
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

// ============================================================================
// Helpers
// ============================================================================

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

// ============================================================================
// Tests
// ============================================================================

describe('POST /api/processes/:id/prewarm', () => {
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
            getWsServer: (() => undefined) as any,
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
        mockPrewarm.mockReset();
        mockPrewarm.mockResolvedValue(undefined);
        for (const key of Object.keys(providerServices)) delete providerServices[key];
        providerServices.copilot = { prewarm: mockPrewarm };
        providerServices.codex = { prewarm: mockPrewarm };
        // Claude is registered but cannot stay warm — no prewarm method.
        providerServices.claude = {};
    });

    it('returns 404 when the process does not exist', async () => {
        const res = await request(baseUrl, '/api/processes/nope/prewarm', { method: 'POST', body: '{}' });
        expect(res.status).toBe(404);
    });

    it('warms the provider client with the process working directory', async () => {
        await store.addProcess({
            id: 'proc-cop',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hi',
            workingDirectory: '/tmp/project',
            metadata: { type: 'chat', provider: 'copilot' },
        } as any);

        const res = await request(baseUrl, '/api/processes/proc-cop/prewarm', { method: 'POST', body: '{}' });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ warming: true, provider: 'copilot' });
        expect(mockPrewarm).toHaveBeenCalledTimes(1);
        expect(mockPrewarm).toHaveBeenCalledWith({ workingDirectory: '/tmp/project' });
    });

    it('routes to the codex service when the conversation provider is codex', async () => {
        await store.addProcess({
            id: 'proc-codex',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hi',
            workingDirectory: '/tmp/cx',
            metadata: { type: 'chat', provider: 'codex' },
        } as any);

        const res = await request(baseUrl, '/api/processes/proc-codex/prewarm', { method: 'POST', body: '{}' });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ warming: true, provider: 'codex' });
        expect(mockPrewarm).toHaveBeenCalledWith({ workingDirectory: '/tmp/cx' });
    });

    it('defaults to copilot when the process has no provider metadata', async () => {
        await store.addProcess({
            id: 'proc-default',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hi',
            workingDirectory: '/tmp/d',
            metadata: { type: 'chat' },
        } as any);

        const res = await request(baseUrl, '/api/processes/proc-default/prewarm', { method: 'POST', body: '{}' });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ warming: true, provider: 'copilot' });
        expect(mockPrewarm).toHaveBeenCalledTimes(1);
    });

    it('no-ops transparently for a provider that cannot stay warm (Claude)', async () => {
        await store.addProcess({
            id: 'proc-claude',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hi',
            workingDirectory: '/tmp/cl',
            metadata: { type: 'chat', provider: 'claude' },
        } as any);

        const res = await request(baseUrl, '/api/processes/proc-claude/prewarm', { method: 'POST', body: '{}' });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ warming: false, provider: 'claude', reason: 'unsupported' });
        expect(mockPrewarm).not.toHaveBeenCalled();
    });

    it('never surfaces a warm-start failure as an error (best-effort)', async () => {
        mockPrewarm.mockRejectedValueOnce(new Error('spawn failed'));
        await store.addProcess({
            id: 'proc-fail',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hi',
            workingDirectory: '/tmp/f',
            metadata: { type: 'chat', provider: 'copilot' },
        } as any);

        const res = await request(baseUrl, '/api/processes/proc-fail/prewarm', { method: 'POST', body: '{}' });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ warming: false, provider: 'copilot', reason: 'error' });
    });
});
