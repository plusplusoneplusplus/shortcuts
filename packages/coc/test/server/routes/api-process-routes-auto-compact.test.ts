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

vi.mock('../../../src/server/core/attachment-utils', async importOriginal => ({
    ...await importOriginal<typeof import('../../../src/server/core/attachment-utils')>(),
    processMessageAttachments: vi.fn().mockReturnValue({
        sdkAttachments: [],
        validatedImages: undefined,
        fileAttachmentMeta: undefined,
        textContext: undefined,
    }),
    hasAttachments: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/server/core/image-utils', async importOriginal => ({
    ...await importOriginal<typeof import('../../../src/server/core/image-utils')>(),
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
        registerApiProcessRoutes({ routes, store, dataDir: 'test-data', gitOpsStore: {} as any });
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
        const res = await put('sentinel', { enabled: true, thresholdTokens: 700000 });
        expect(res.status).toBe(200);
        expect(res.json().autoCompact).toMatchObject({ enabled: true, thresholdTokens: 700000, consecutiveFailures: 0 });
        expect((await store.getProcess('sentinel'))!.metadata!.autoCompact).toMatchObject({ enabled: true, thresholdTokens: 700000 });
        expect(mockCompactSession).not.toHaveBeenCalled();
        expect((await store.getProcess('sentinel'))!.metadata!.compaction).toBeUndefined();
    });

    it('rejects non-Sentinel chats, other workspaces and invalid thresholds', async () => {
        const plain = await put('plain', { enabled: true, thresholdTokens: 700000 });
        expect(plain.status).toBe(422);
        expect(plain.body).toContain('AUTO_COMPACT_SENTINEL_ONLY');
        expect((await put('sentinel', { enabled: true, thresholdTokens: 700000 }, 'ws-b')).status).toBe(404);
        for (const thresholdTokens of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, '700000']) {
            expect((await put('sentinel', { enabled: true, thresholdTokens })).status).toBe(400);
        }
        expect((await put('sentinel', { thresholdPercent: 80 })).status).toBe(400);
        expect((await store.getProcess('sentinel'))!.metadata!.autoCompact).toBeUndefined();
    });

    it('resumes a paused state', async () => {
        const resumeUrl = '/api/processes/sentinel/auto-compact/resume?workspace=ws-a';
        expect((await request(baseUrl, resumeUrl, { method: 'POST', body: '{}' })).status).toBe(409);
        const meta = (await store.getProcess('sentinel'))!.metadata!;
        await store.updateProcess('sentinel', { metadata: { ...meta, autoCompact: { enabled: true, thresholdTokens: 700000,
            consecutiveFailures: 2, paused: { reason: 'failures', at: '2026-10-01T00:00:00Z' } } } });
        const res = await request(baseUrl, resumeUrl, { method: 'POST', body: '{}' });
        expect(res.status).toBe(200);
        expect(res.json().autoCompact).toEqual({ enabled: true, thresholdTokens: 700000, consecutiveFailures: 0 });
        expect(mockCompactSession).not.toHaveBeenCalled();
    });

    it('keeps auto-compact state out of the generic metadata PATCH', async () => {
        await put('sentinel', { enabled: true, thresholdTokens: 700000 });
        const patch = (body: unknown) => request(baseUrl, '/api/processes/sentinel?workspace=ws-a', { method: 'PATCH', body: JSON.stringify(body) });
        expect((await patch({ metadataPatch: { set: { autoCompact: { enabled: false } } } })).status).toBe(400);
        expect((await patch({ metadataPatch: { unset: ['autoCompact'] } })).status).toBe(400);
        const full = await patch({ metadata: { type: 'chat', workspaceId: 'ws-a', mode: 'sentinel', autoCompact: { enabled: false, thresholdTokens: 1 } } });
        expect(full.status).toBe(200);
        expect((await store.getProcess('sentinel'))!.metadata!.autoCompact).toMatchObject({ enabled: true, thresholdTokens: 700000 });
    });

    it.each([false, true])('rejects unsupported persisted percentage state on resume and accepts explicit replacement (%s)', async enabled => {
        const meta = (await store.getProcess('sentinel'))!.metadata!;
        const obsolete = { enabled, thresholdPercent: 80, taskId: 'obsolete', consecutiveFailures: 2 };
        await store.updateProcess('sentinel', { metadata: { ...meta, autoCompact: obsolete } });
        const resumeUrl = '/api/processes/sentinel/auto-compact/resume?workspace=ws-a';
        const res = await request(baseUrl, resumeUrl, { method: 'POST', body: '{}' });
        expect(res.status).toBe(409);
        expect(res.json()).toMatchObject({ code: 'AUTO_COMPACT_UNSUPPORTED_STATE', error: expect.stringContaining('PUT') });
        expect((await store.getProcess('sentinel'))!.metadata!.autoCompact).toEqual(obsolete);
        expect((await put('sentinel', { enabled: true, thresholdPercent: 80 })).status).toBe(400);
        expect((await put('sentinel', { enabled: true, thresholdPercent: 80, thresholdTokens: 700000 })).status).toBe(400);
        const replacement = await put('sentinel', { enabled: false, thresholdTokens: 700000 });
        expect(replacement.status).toBe(200);
        expect(replacement.json().autoCompact).toEqual({ enabled: false, thresholdTokens: 700000, consecutiveFailures: 0, updatedAt: expect.any(String) });
        expect((await put('sentinel', { enabled: true, thresholdTokens: 700000 })).status).toBe(200);
        expect(mockCompactSession).not.toHaveBeenCalled();
    });

    it.each([1, Number.MAX_SAFE_INTEGER])('accepts every positive safe-integer threshold boundary (%s)', async thresholdTokens => {
        expect((await put('sentinel', { enabled: true, thresholdTokens })).status).toBe(200);
    });

    it('returns explicit errors for non-finite and unsafe JSON numbers', async () => {
        for (const number of ['1e309', '-1e309', '9007199254740992']) {
            const result = await request(baseUrl, '/api/processes/sentinel/auto-compact?workspace=ws-a',
                { method: 'PUT', body: `{"enabled":true,"thresholdTokens":${number}}` });
            expect(result.status).toBe(400);
            expect(result.json().error).toContain('finite positive safe integer');
        }
    });

    it('reports save and resume persistence failures without a success response or compaction', async () => {
        vi.mocked(store.updateProcess).mockRejectedValueOnce(new Error('settings persistence failed'));
        const save = await put('sentinel', { enabled: true, thresholdTokens: 700000 });
        expect(save.status).toBe(500);
        expect(save.json().code).toBe('INTERNAL_ERROR');
        expect((await store.getProcess('sentinel'))!.metadata!.autoCompact).toBeUndefined();
        await put('sentinel', { enabled: true, thresholdTokens: 700000 });
        const meta = (await store.getProcess('sentinel'))!.metadata!;
        await store.updateProcess('sentinel', { metadata: { ...meta, autoCompact: {
            ...(meta.autoCompact as object), consecutiveFailures: 2, paused: { reason: 'failures', at: '' },
        } } });
        vi.mocked(store.updateProcess).mockRejectedValueOnce(new Error('resume persistence failed'));
        const resume = await request(baseUrl, '/api/processes/sentinel/auto-compact/resume?workspace=ws-a', { method: 'POST', body: '{}' });
        expect(resume.status).toBe(500);
        expect((await store.getProcess('sentinel'))!.metadata!.autoCompact).toMatchObject({ consecutiveFailures: 2, paused: { reason: 'failures' } });
        expect(mockCompactSession).not.toHaveBeenCalled();
    });
});
