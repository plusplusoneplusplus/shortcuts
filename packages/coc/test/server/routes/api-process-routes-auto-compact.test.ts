/**
 * Sentinel auto-compact settings routes: PUT /api/processes/:id/auto-compact and
 * POST /api/processes/:id/auto-compact/resume. Covers Sentinel-only and
 * owning-workspace validation, threshold validation, no compaction on save, and
 * protection of the server-owned state from the generic metadata PATCH.
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

const mockCompactSession = vi.fn();
const requestedProviders: string[] = [];

// Stub the SDK registry but keep the REAL isCompactUnsupportedError guard and the
// REAL CompactUnsupportedError class (the route imports the guard dynamically).
vi.mock('@plusplusoneplusplus/forge', async () => {
    const actual = await vi.importActual('@plusplusoneplusplus/forge');
    return {
        ...actual as object,
        sdkServiceRegistry: {
            getOrThrow: (provider: string) => {
                requestedProviders.push(provider);
                return { compactSession: mockCompactSession };
            },
        },
    };
});

// Stub SSE handler (unused by this route but imported by the module).
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
// Tests
// ============================================================================

describe('auto-compact settings routes', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore();
        const routes: Route[] = [];
        registerApiProcessRoutes({ routes, store, dataDir: '/tmp/test-coc', gitOpsStore: {} as any });
        server = http.createServer(createRouter({ routes }));
        await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()); });
        baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(async () => {
        store.processes.clear();
        mockCompactSession.mockReset();
        await store.addProcess({ id: 'sentinel', type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 's',
            sdkSessionId: 'sess', currentTokens: 950, tokenLimit: 1000,
            metadata: { type: 'chat', workspaceId: 'ws-a', mode: 'sentinel' } });
        await store.addProcess({ id: 'plain', type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'p',
            metadata: { type: 'chat', workspaceId: 'ws-a', mode: 'ask' } });
    });

    const put = (id: string, body: unknown, ws = 'ws-a') => request(baseUrl, `/api/processes/${id}/auto-compact?workspace=${ws}`,
        { method: 'PUT', body: JSON.stringify(body) });

    it('saves a valid setting on the owning Sentinel chat without compacting', async () => {
        const res = await put('sentinel', { enabled: true, thresholdPercent: 85 });
        expect(res.status).toBe(200);
        expect(res.json().autoCompact).toMatchObject({ enabled: true, thresholdPercent: 85, consecutiveFailures: 0 });
        expect((await store.getProcess('sentinel'))!.metadata!.autoCompact).toMatchObject({ enabled: true, thresholdPercent: 85 });
        expect(mockCompactSession).not.toHaveBeenCalled();
        expect((await store.getProcess('sentinel'))!.metadata!.compaction).toBeUndefined();
    });

    it('rejects non-Sentinel chats, other workspaces and invalid thresholds', async () => {
        const plain = await put('plain', { enabled: true, thresholdPercent: 80 });
        expect(plain.status).toBe(422);
        expect(plain.body).toContain('AUTO_COMPACT_SENTINEL_ONLY');
        expect((await put('sentinel', { enabled: true, thresholdPercent: 80 }, 'ws-b')).status).toBe(404);
        for (const thresholdPercent of [40, 96, 83]) {
            expect((await put('sentinel', { enabled: true, thresholdPercent })).status).toBe(400);
        }
        expect((await put('sentinel', { thresholdPercent: 80 })).status).toBe(400);
        expect((await store.getProcess('sentinel'))!.metadata!.autoCompact).toBeUndefined();
    });

    it('resumes a paused state', async () => {
        const resumeUrl = '/api/processes/sentinel/auto-compact/resume?workspace=ws-a';
        expect((await request(baseUrl, resumeUrl, { method: 'POST', body: '{}' })).status).toBe(409);
        const meta = (await store.getProcess('sentinel'))!.metadata!;
        await store.updateProcess('sentinel', { metadata: { ...meta, autoCompact: { enabled: true, thresholdPercent: 80,
            consecutiveFailures: 2, paused: { reason: 'failures', at: '2026-10-01T00:00:00Z' } } } });
        const res = await request(baseUrl, resumeUrl, { method: 'POST', body: '{}' });
        expect(res.status).toBe(200);
        expect(res.json().autoCompact).toEqual({ enabled: true, thresholdPercent: 80, consecutiveFailures: 0 });
        expect(mockCompactSession).not.toHaveBeenCalled();
    });

    it('keeps auto-compact state out of the generic metadata PATCH', async () => {
        await put('sentinel', { enabled: true, thresholdPercent: 80 });
        const patch = (body: unknown) => request(baseUrl, '/api/processes/sentinel?workspace=ws-a', { method: 'PATCH', body: JSON.stringify(body) });
        expect((await patch({ metadataPatch: { set: { autoCompact: { enabled: false } } } })).status).toBe(400);
        expect((await patch({ metadataPatch: { unset: ['autoCompact'] } })).status).toBe(400);
        const full = await patch({ metadata: { type: 'chat', workspaceId: 'ws-a', mode: 'sentinel', autoCompact: { enabled: false, thresholdPercent: 50 } } });
        expect(full.status).toBe(200);
        expect((await store.getProcess('sentinel'))!.metadata!.autoCompact).toMatchObject({ enabled: true, thresholdPercent: 80 });
    });
});
